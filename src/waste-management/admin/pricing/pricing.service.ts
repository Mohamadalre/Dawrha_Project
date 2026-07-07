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
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { SetPricingDto } from './dto/set-pricing.dto';
import { UpdateTierPriceDto } from './dto/update-tier-price.dto';

const DEFAULT_CURRENCY = 'JOD';

/**
 * Tiered pricing admin logic.
 *
 * The live `product_pricing` table holds ONLY the current price per tier. Every
 * time a price is replaced (full-list update or single-tier edit) or the list is
 * deleted, the previous live row is moved into `product_pricing_history`, so the
 * admin can review past prices while reads stay simple and fast.
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
  ) {}

  // ---------------------------------------------------------------------------
  // Full-list update (all four tiers)
  // ---------------------------------------------------------------------------
  async setPricing(adminId: string, productId: string, dto: SetPricingDto) {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    const effectiveFrom = dto.effective_from ? new Date(dto.effective_from) : new Date();
    const tierValues: Record<PricingTier, number> = {
      [PricingTier.INDIVIDUAL]: dto.individual,
      [PricingTier.COMPANY]: dto.company,
      [PricingTier.FACTORY]: dto.factory,
      [PricingTier.FREE_FACILITY]: dto.free_facility,
    };

    for (const tier of Object.values(PricingTier)) {
      await this.archiveCurrent(productId, tier, PricingArchiveReason.UPDATED, adminId);
      await this.insertCurrent(productId, tier, tierValues[tier], DEFAULT_CURRENCY, effectiveFrom);
    }

    const updatedCarts = await this.repriceActiveCarts(productId, tierValues);
    await this.odooSync.enqueueUpdatePricing({ productId });
    await this.audit.record({
      userId: adminId,
      action: 'SET_PRICING',
      entityType: 'product_pricing',
      entityId: productId,
      newValues: { ...tierValues, effectiveFrom },
    });
    await this.cache.invalidate('products');

    return {
      product_id: productId,
      pricing: {
        individual: dto.individual,
        company: dto.company,
        factory: dto.factory,
        free_facility: dto.free_facility,
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
   * Updates the price of ONE tier only. The previous value of that tier is moved
   * to history; the other tiers are left untouched.
   */
  async updateTierPrice(
    adminId: string,
    productId: string,
    tier: PricingTier,
    dto: UpdateTierPriceDto,
  ) {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    const effectiveFrom = dto.effective_from ? new Date(dto.effective_from) : new Date();
    const currency = dto.currency ?? DEFAULT_CURRENCY;

    await this.archiveCurrent(productId, tier, PricingArchiveReason.UPDATED, adminId);
    await this.insertCurrent(productId, tier, dto.price, currency, effectiveFrom);

    const updatedCarts = await this.repriceTier(productId, tier, dto.price);
    await this.odooSync.enqueueUpdatePricing({ productId });
    await this.audit.record({
      userId: adminId,
      action: 'UPDATE_TIER_PRICING',
      entityType: 'product_pricing',
      entityId: productId,
      newValues: { tier, price: dto.price, effectiveFrom },
    });
    await this.cache.invalidate('products');

    return {
      product_id: productId,
      tier: tier.toLowerCase(),
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
  /** Current price per tier from the live table (null when a tier is unpriced). */
  async getCurrentPricing(productId: string) {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    const rows = await this.pricingRepo.find({ where: { productId } });
    const priceOf = (tier: PricingTier): number | null => {
      const row = rows.find((r) => r.tier === tier);
      return row ? Number(row.price) : null;
    };

    return {
      product_id: productId,
      pricing: {
        individual: priceOf(PricingTier.INDIVIDUAL),
        company: priceOf(PricingTier.COMPANY),
        factory: priceOf(PricingTier.FACTORY),
        free_facility: priceOf(PricingTier.FREE_FACILITY),
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
  /** Moves the current live row(s) of a tier into history and removes them. */
  private async archiveCurrent(
    productId: string,
    tier: PricingTier,
    reason: PricingArchiveReason,
    adminId: string,
  ): Promise<ProductPricing[]> {
    const liveRows = await this.pricingRepo.find({ where: { productId, tier } });
    if (liveRows.length === 0) return [];

    const archivedAt = new Date();
    await this.historyRepo.save(
      liveRows.map((r) =>
        this.historyRepo.create({
          productId: r.productId,
          tier: r.tier,
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

  /** Inserts the new current price row for a tier. */
  private async insertCurrent(
    productId: string,
    tier: PricingTier,
    price: number,
    currency: string,
    effectiveFrom: Date,
  ): Promise<void> {
    await this.pricingRepo.save(
      this.pricingRepo.create({
        productId,
        tier,
        price: String(price),
        currency,
        effectiveFrom,
        effectiveUntil: undefined,
      }),
    );
  }

  /** Re-prices non-offer cart lines for ALL tiers (full-list update). */
  private async repriceActiveCarts(
    productId: string,
    tierValues: Record<PricingTier, number>,
  ): Promise<number> {
    const items = await this.cartItemRepo.find({
      where: { productId, isOffer: false },
      relations: ['cart', 'cart.account'],
    });

    let updated = 0;
    for (const item of items) {
      const role = item.cart?.account?.role;
      if (!role) continue;
      const newPrice = tierValues[tierForRole(role)];
      item.unitPrice = String(newPrice);
      item.subtotal = String(+(newPrice * Number(item.quantity)).toFixed(3));
      await this.cartItemRepo.save(item);
      updated++;
    }
    return updated;
  }

  /** Re-prices non-offer cart lines belonging to ONE tier (single-tier edit). */
  private async repriceTier(
    productId: string,
    tier: PricingTier,
    price: number,
  ): Promise<number> {
    const items = await this.cartItemRepo.find({
      where: { productId, isOffer: false },
      relations: ['cart', 'cart.account'],
    });

    let updated = 0;
    for (const item of items) {
      const role = item.cart?.account?.role;
      if (!role || tierForRole(role) !== tier) continue;
      item.unitPrice = String(price);
      item.subtotal = String(+(price * Number(item.quantity)).toFixed(3));
      await this.cartItemRepo.save(item);
      updated++;
    }
    return updated;
  }
}
