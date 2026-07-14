import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '@src/waste-management/entities/product.entity';
import { ProductPricing } from '@src/waste-management/entities/product-pricing.entity';
import { ProductPricingHistory } from '@src/waste-management/entities/product-pricing-history.entity';
import { CartItem } from '@src/waste-management/entities/cart-item.entity';
import { PricingTier, tierForRole } from '@src/waste-management/enums/pricing-tier.enum';
import { PricingArchiveReason } from '@src/waste-management/enums/pricing-archive-reason.enum';
import { AuditService } from '@src/waste-management/common/providers/audit.service';
import { CatalogCacheService } from '@src/waste-management/common/providers/catalog-cache.service';
import { ConditionsService } from '@src/waste-management/common/providers/conditions.service';
import { ConditionRequiredException } from '@src/waste-management/exceptions/waste.exceptions';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { ConditionPriceDto, SetPricingDto } from './dto/set-pricing.dto';
import { UpdateTierPriceDto } from './dto/update-tier-price.dto';

const DEFAULT_CURRENCY = 'JOD';

/** Tiers priced per material condition (Odoo invoices these two by grade). */
const CONDITION_TIERS = [PricingTier.FACTORY, PricingTier.FREE_FACILITY];

/** Normalised condition price line (code already validated + uppercased). */
export interface ConditionLine {
  condition: string;
  price: number;
}

/** Per-tier price values used when re-pricing carts. */
interface TierValues {
  [PricingTier.INDIVIDUAL]: number;
  [PricingTier.COMPANY]: number;
  [PricingTier.FACTORY]: Map<string, number>;
  [PricingTier.FREE_FACILITY]: Map<string, number>;
}

/**
 * Tiered pricing admin logic.
 *
 * The live `product_pricing` table holds ONLY the current prices. Every time a
 * price is replaced (full-list update or single-tier edit) or the list is
 * deleted, the previous live rows move into `product_pricing_history`, so the
 * admin can review past prices while reads stay simple and fast.
 *
 * Pricing model:
 *  - INDIVIDUAL / COMPANY: one price per product (conditionCode = null).
 *  - FACTORY / FREE_FACILITY: one price PER material condition — the sorter in
 *    Odoo grades stock, and Odoo invoices these buyers per grade, so the whole
 *    condition-price matrix is pushed to Odoo (UPDATE_PRICING job).
 */
@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductPricing)
    private readonly pricingRepo: Repository<ProductPricing>,
    @InjectRepository(ProductPricingHistory)
    private readonly historyRepo: Repository<ProductPricingHistory>,
    @InjectRepository(CartItem)
    private readonly cartItemRepo: Repository<CartItem>,
    private readonly odooSync: OdooSyncService,
    private readonly audit: AuditService,
    private readonly cache: CatalogCacheService,
    private readonly conditions: ConditionsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Full-list update (all four tiers)
  // ---------------------------------------------------------------------------
  async setPricing(adminId: string, productId: string, dto: SetPricingDto) {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    const effectiveFrom = dto.effective_from ? new Date(dto.effective_from) : new Date();
    const factoryLines = await this.normalizeConditionLines(dto.factory);
    const freeFacilityLines = await this.normalizeConditionLines(dto.free_facility);

    // Archive everything live, then insert the new list.
    for (const tier of Object.values(PricingTier)) {
      await this.archiveCurrent(productId, tier, PricingArchiveReason.UPDATED, adminId);
    }
    await this.insertCurrent(productId, PricingTier.INDIVIDUAL, dto.individual, DEFAULT_CURRENCY, effectiveFrom, null);
    await this.insertCurrent(productId, PricingTier.COMPANY, dto.company, DEFAULT_CURRENCY, effectiveFrom, null);
    for (const line of factoryLines) {
      await this.insertCurrent(productId, PricingTier.FACTORY, line.price, DEFAULT_CURRENCY, effectiveFrom, line.condition);
    }
    for (const line of freeFacilityLines) {
      await this.insertCurrent(productId, PricingTier.FREE_FACILITY, line.price, DEFAULT_CURRENCY, effectiveFrom, line.condition);
    }

    const updatedCarts = await this.repriceActiveCarts(productId, {
      [PricingTier.INDIVIDUAL]: dto.individual,
      [PricingTier.COMPANY]: dto.company,
      [PricingTier.FACTORY]: new Map(factoryLines.map((l) => [l.condition, l.price])),
      [PricingTier.FREE_FACILITY]: new Map(freeFacilityLines.map((l) => [l.condition, l.price])),
    });

    await this.odooSync.enqueueUpdatePricing({ productId });
    await this.audit.record({
      userId: adminId,
      action: 'SET_PRICING',
      entityType: 'product_pricing',
      entityId: productId,
      newValues: {
        individual: dto.individual,
        company: dto.company,
        factory: factoryLines,
        free_facility: freeFacilityLines,
        effectiveFrom,
      },
    });
    await this.cache.invalidate('products');

    return {
      product_id: productId,
      pricing: {
        individual: dto.individual,
        company: dto.company,
        factory: factoryLines,
        free_facility: freeFacilityLines,
      },
      effective_from: effectiveFrom,
      updated_cart_items: updatedCarts,
      message: 'Pricing updated successfully',
    };
  }

  // ---------------------------------------------------------------------------
  // Single-tier edit
  // ---------------------------------------------------------------------------
  /**
   * Updates ONE price: for INDIVIDUAL/COMPANY the tier's single price; for
   * FACTORY/FREE_FACILITY the price of ONE condition (required in the body).
   * The previous value moves to history; everything else is untouched.
   */
  async updateTierPrice(
    adminId: string,
    productId: string,
    tier: PricingTier,
    dto: UpdateTierPriceDto,
  ) {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    const isConditionTier = CONDITION_TIERS.includes(tier);
    let conditionCode: string | null = null;
    if (isConditionTier) {
      if (!dto.condition) throw new ConditionRequiredException();
      conditionCode = await this.conditions.validateActiveCode(dto.condition);
    }

    const effectiveFrom = dto.effective_from ? new Date(dto.effective_from) : new Date();
    const currency = dto.currency ?? DEFAULT_CURRENCY;

    await this.archiveCurrent(productId, tier, PricingArchiveReason.UPDATED, adminId, conditionCode);
    await this.insertCurrent(productId, tier, dto.price, currency, effectiveFrom, conditionCode);

    const updatedCarts = await this.repriceTier(productId, tier, dto.price, conditionCode);
    await this.odooSync.enqueueUpdatePricing({ productId });
    await this.audit.record({
      userId: adminId,
      action: 'UPDATE_TIER_PRICING',
      entityType: 'product_pricing',
      entityId: productId,
      newValues: { tier, condition: conditionCode, price: dto.price, effectiveFrom },
    });
    await this.cache.invalidate('products');

    return {
      product_id: productId,
      tier: tier.toLowerCase(),
      condition: conditionCode,
      price: dto.price,
      currency,
      effective_from: effectiveFrom,
      updated_cart_items: updatedCarts,
      message: 'Tier price updated successfully',
    };
  }

  // ---------------------------------------------------------------------------
  // Delete the whole list (archive everything)
  // ---------------------------------------------------------------------------
  async deletePricing(adminId: string, productId: string) {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    let archived = 0;
    for (const tier of Object.values(PricingTier)) {
      const rows = await this.archiveCurrent(productId, tier, PricingArchiveReason.DELETED, adminId);
      archived += rows.length;
    }

    if (archived === 0) {
      throw new BadRequestException('Product has no active pricing to delete');
    }

    await this.audit.record({
      userId: adminId,
      action: 'DELETE_PRICING',
      entityType: 'product_pricing',
      entityId: productId,
      oldValues: { archived_rows: archived },
    });
    await this.cache.invalidate('products');

    return {
      product_id: productId,
      archived_rows: archived,
      message: 'Pricing deleted and moved to history',
    };
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------
  /**
   * Current prices: single numbers for INDIVIDUAL/COMPANY, per-condition arrays
   * for FACTORY/FREE_FACILITY (null / empty when unpriced).
   */
  async getCurrentPricing(productId: string) {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    const rows = await this.pricingRepo.find({ where: { productId } });
    const flatPrice = (tier: PricingTier): number | null => {
      const row = rows.find((r) => r.tier === tier && !r.conditionCode);
      return row ? Number(row.price) : null;
    };
    const conditionPrices = (tier: PricingTier) =>
      rows
        .filter((r) => r.tier === tier && r.conditionCode)
        .map((r) => ({ condition: r.conditionCode, price: Number(r.price) }));

    return {
      product_id: productId,
      pricing: {
        individual: flatPrice(PricingTier.INDIVIDUAL),
        company: flatPrice(PricingTier.COMPANY),
        factory: conditionPrices(PricingTier.FACTORY),
        free_facility: conditionPrices(PricingTier.FREE_FACILITY),
      },
    };
  }

  /** Previous (archived) prices grouped per tier, newest first. */
  async getPriceHistory(productId: string) {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    const rows = await this.historyRepo.find({
      where: { productId },
      order: { archivedAt: 'DESC' },
    });

    const tiers: Record<string, unknown> = {};
    for (const tier of Object.values(PricingTier)) {
      tiers[tier.toLowerCase()] = rows
        .filter((r) => r.tier === tier)
        .map((r) => ({
          condition: r.conditionCode ?? null,
          price: Number(r.price),
          currency: r.currency,
          effective_from: r.effectiveFrom,
          archived_at: r.archivedAt,
          archived_reason: r.archivedReason,
        }));
    }

    return { product_id: productId, tiers };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  /** Validates + uppercases condition codes and rejects duplicates in one list. */
  private async normalizeConditionLines(lines: ConditionPriceDto[]): Promise<ConditionLine[]> {
    const seen = new Set<string>();
    const out: ConditionLine[] = [];
    for (const line of lines) {
      const condition = await this.conditions.validateActiveCode(line.condition);
      if (seen.has(condition)) {
        throw new BadRequestException(`Duplicate condition "${condition}" in pricing list`);
      }
      seen.add(condition);
      out.push({ condition, price: line.price });
    }
    return out;
  }

  /**
   * Moves live row(s) of a tier into history and removes them.
   * `conditionCode` narrows the scope: undefined = every row of the tier,
   * null = the tier-wide row only, string = that condition's row only.
   */
  private async archiveCurrent(
    productId: string,
    tier: PricingTier,
    reason: PricingArchiveReason,
    adminId: string,
    conditionCode?: string | null,
  ): Promise<ProductPricing[]> {
    const allRows = await this.pricingRepo.find({ where: { productId, tier } });
    const liveRows =
      conditionCode === undefined
        ? allRows
        : allRows.filter((r) => (r.conditionCode ?? null) === conditionCode);
    if (liveRows.length === 0) return [];

    const archivedAt = new Date();
    await this.historyRepo.save(
      liveRows.map((r) =>
        this.historyRepo.create({
          productId: r.productId,
          tier: r.tier,
          conditionCode: r.conditionCode ?? null,
          price: r.price,
          currency: r.currency,
          effectiveFrom: r.effectiveFrom,
          archivedAt,
          archivedReason: reason,
          archivedBy: adminId,
        }),
      ),
    );
    await this.pricingRepo.remove(liveRows);
    return liveRows;
  }

  /** Inserts one new current price row. */
  private async insertCurrent(
    productId: string,
    tier: PricingTier,
    price: number,
    currency: string,
    effectiveFrom: Date,
    conditionCode: string | null,
  ): Promise<void> {
    await this.pricingRepo.save(
      this.pricingRepo.create({
        productId,
        tier,
        conditionCode,
        price: String(price),
        currency,
        effectiveFrom,
        effectiveUntil: undefined,
      }),
    );
  }

  /** Re-prices non-offer cart lines for ALL tiers (full-list update). */
  private async repriceActiveCarts(productId: string, values: TierValues): Promise<number> {
    const items = await this.cartItemRepo.find({
      where: { productId, isOffer: false },
      relations: ['cart', 'cart.account'],
    });

    let updated = 0;
    for (const item of items) {
      const role = item.cart?.account?.role;
      if (!role) continue;
      const newPrice = this.priceFor(values, tierForRole(role), item.conditionCode ?? null);
      if (newPrice == null) continue; // e.g. condition no longer priced — keep the old price
      item.unitPrice = String(newPrice);
      item.subtotal = String(+(newPrice * Number(item.quantity)).toFixed(3));
      await this.cartItemRepo.save(item);
      updated++;
    }
    return updated;
  }

  /** Re-prices non-offer cart lines of ONE tier (and one condition, if given). */
  private async repriceTier(
    productId: string,
    tier: PricingTier,
    price: number,
    conditionCode: string | null,
  ): Promise<number> {
    const items = await this.cartItemRepo.find({
      where: { productId, isOffer: false },
      relations: ['cart', 'cart.account'],
    });

    let updated = 0;
    for (const item of items) {
      const role = item.cart?.account?.role;
      if (!role || tierForRole(role) !== tier) continue;
      if (conditionCode !== null && (item.conditionCode ?? null) !== conditionCode) continue;
      item.unitPrice = String(price);
      item.subtotal = String(+(price * Number(item.quantity)).toFixed(3));
      await this.cartItemRepo.save(item);
      updated++;
    }
    return updated;
  }

  /** Resolves the new price of a cart line from the tier values. */
  private priceFor(
    values: TierValues,
    tier: PricingTier,
    conditionCode: string | null,
  ): number | null {
    if (tier === PricingTier.INDIVIDUAL) return values[PricingTier.INDIVIDUAL];
    if (tier === PricingTier.COMPANY) return values[PricingTier.COMPANY];
    const map = values[tier as PricingTier.FACTORY | PricingTier.FREE_FACILITY];
    if (!conditionCode) return null;
    return map.get(conditionCode) ?? null;
  }
}
