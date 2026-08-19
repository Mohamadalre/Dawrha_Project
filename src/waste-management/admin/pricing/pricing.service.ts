import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
import {
  describeExpectedShape,
  isPricedPerCondition,
} from './pricing-shape';
import { ProductConditionsService } from '../product-conditions.service';
import { OfferSettlementService } from '@src/waste-management/common/providers/offer-settlement.service';
import { UpdateTierPriceDto } from './dto/update-tier-price.dto';
import { UpdatePricingTableDto } from './dto/update-pricing-table.dto';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';
import { Account } from '@src/user/entities/account.entity';
import { Role } from '@src/user/enums/role.enum';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { PlatformSettingsService } from '@src/platform-settings/platform-settings.service';


/**
 * Map key standing in for 'this material has no conditions, this is its single
 * price for the tier'. An empty string (not null) so the map stays
 * Map<string, number> and a lookup can never collide with a real code, which
 * must match /^[A-Z0-9_]+$/.
 */
const PLAIN_PRICE_KEY = '';

/** Tiers priced per material condition (Odoo invoices these two by grade). */
const CONDITION_TIERS = [PricingTier.FACTORY, PricingTier.FREE_FACILITY];

/**
 * Normalised condition price line (code already validated + uppercased).
 * `condition` is null for a material that has no conditions: the tier then
 * carries a single plain price.
 */
export interface ConditionLine {
  condition: string | null;
  /**
   * The grade this price is filed against, by id.
   *
   * The code beside it is the label Odoo and the basket read; THIS is the link.
   * Both travel together from the one place that resolves them, so a price can
   * never be attached to one grade and labelled as another — which on this
   * table means money charged for something the buyer did not order.
   */
  conditionId: string | null;
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
    private readonly productConditions: ProductConditionsService,
    private readonly offerSettlement: OfferSettlementService,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly notifications: NotificationService,
    private readonly settings: PlatformSettingsService,
  ) {}

  // ---------------------------------------------------------------------------
  /**
   * The material a pricing write is about.
   *
   * A WITHDRAWN MATERIAL MAY STILL BE PRICED, deliberately — and this note
   * exists because the opposite was tried and was worse.
   *
   * Blocking it looks safe: an inactive material is off the shelf, so prices
   * written on it reach nobody. But follow what an administrator must then do
   * to correct a wrong price on a withdrawn material — reactivate it, which
   * publishes the WRONG price to every buyer, and only then fix it. The block
   * forces the bad number to go live before it can be repaired.
   *
   * Preparing prices while a material is withdrawn is the natural order:
   * withdraw, correct, republish. Nothing is exposed in the meantime, because
   * every catalogue query already filters on `isActive` — the material's own
   * flag is what hides it, not a restriction on editing it.
   *
   * OFFERS are the opposite case and are still refused (see
   * `AdminCatalogService.createOffer`). A price is a standing attribute a
   * material carries whether or not it is on sale; an offer is a promotion, and
   * promoting something nobody can buy is meaningless — it would also lie
   * dormant and spring back at reactivation.
   */
  private async productOrThrow(productId: string): Promise<Product> {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  // ---------------------------------------------------------------------------
  // Full-list update (all four tiers)
  // ---------------------------------------------------------------------------
  async setPricing(adminId: string, productId: string, dto: SetPricingDto) {
    const product = await this.productOrThrow(productId);

    const effectiveFrom = dto.effective_from ? new Date(dto.effective_from) : new Date();
    // The shape of a price list is decided by the MATERIAL, not by the tier
    // alone: an ungraded material takes one price for every tier, factories
    // included, because there is nothing to price per grade.
    const graded = await this.productConditions.hasConditions(productId);
    const factoryLines = await this.normalizeConditionLines(
      dto.factory, productId, PricingTier.FACTORY, graded);
    const freeFacilityLines = await this.normalizeConditionLines(
      dto.free_facility, productId, PricingTier.FREE_FACILITY, graded);

    // Archive everything live, then insert the new list.
    for (const tier of Object.values(PricingTier)) {
      await this.archiveCurrent(productId, tier, PricingArchiveReason.UPDATED, adminId);
    }
    // The currency for these new rows comes from the platform setting, so
    // changing the platform currency flows here without a code change.
    const currency = await this.settings.defaultCurrency();
    // Kept as we insert so the response can carry each new row's id per role.
    const individualRow = await this.insertCurrent(productId, PricingTier.INDIVIDUAL, dto.individual, currency, effectiveFrom, null);
    const companyRow = await this.insertCurrent(productId, PricingTier.COMPANY, dto.company, currency, effectiveFrom, null);
    const factoryRows: ProductPricing[] = [];
    for (const line of factoryLines) {
      factoryRows.push(await this.insertCurrent(productId, PricingTier.FACTORY, line.price, currency, effectiveFrom, line.condition, line.conditionId));
    }
    const freeFacilityRows: ProductPricing[] = [];
    for (const line of freeFacilityLines) {
      freeFacilityRows.push(await this.insertCurrent(productId, PricingTier.FREE_FACILITY, line.price, currency, effectiveFrom, line.condition, line.conditionId));
    }

    const updatedCarts = await this.repriceActiveCarts(productId, {
      [PricingTier.INDIVIDUAL]: dto.individual,
      [PricingTier.COMPANY]: dto.company,
      [PricingTier.FACTORY]: toPriceMap(factoryLines),
      [PricingTier.FREE_FACILITY]: toPriceMap(freeFacilityLines),
    });

    // The price just moved, so every offer on this material has to be
    // re-derived against it: the stored percentage is now wrong, and an
    // amount that no longer fits would make the price NEGATIVE. Done BEFORE
    // the push so Odoo receives the corrected picture, not the broken one.
    await this.offerSettlement.resettle(productId, adminId);
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
    // 'offers' too, not only 'products': the offers listing shows each offer's
    // price and percentage DERIVED from the material's base price, so a price
    // change leaves those figures stale in the cached offers page unless it is
    // dropped here as well. This was the bug where editing a price left the
    // offers route serving the old numbers.
    await this.cache.invalidate('products', 'offers');

    // The response carries the pricing-row id of EVERY role (citizen /
    // institution / each factory grade / each free-facility grade) — the id the
    // admin needs to later correct or expire that exact row. Same shape the GET
    // current-pricing route returns, built from the rows just inserted.
    const flatRow = (row: ProductPricing) => ({
      pricing_id: row.id,
      price: Number(row.price),
      currency: row.currency,
    });
    const gradedRow = (row: ProductPricing) => ({
      pricing_id: row.id,
      condition_id: row.conditionId ?? null,
      condition: row.conditionCode ?? null,
      price: Number(row.price),
      currency: row.currency,
    });

    return {
      product_id: productId,
      pricing: {
        individual: flatRow(individualRow),
        company: flatRow(companyRow),
        factory: factoryRows.map(gradedRow),
        free_facility: freeFacilityRows.map(gradedRow),
      },
      effective_from: effectiveFrom,
      updated_cart_items: updatedCarts,
      message: 'Pricing updated successfully',
    };
  }

  // ---------------------------------------------------------------------------
  // Table edit — any subset of roles, in one call
  // ---------------------------------------------------------------------------
  /**
   * Edits the price table, touching only the tiers that were sent.
   *
   * An EDIT, not a replace: a tier the caller left out keeps exactly the prices
   * it had. Raising the citizen price must not silently wipe the factory grades
   * nobody mentioned — and a full-replace endpoint makes that mistake one
   * forgotten field away.
   *
   * The role is the KEY, never a field in the body, so editing two tiers at
   * once is one atomic call instead of two that can half-fail.
   *
   * Prices already frozen onto a placed order are untouched by design: this
   * writes to  and re-prices open CARTS only. An order is a
   * contract at the moment it was placed.
   */
  async updatePricingTable(
    adminId: string,
    productId: string,
    dto: UpdatePricingTableDto,
  ) {
    const product = await this.productOrThrow(productId);

    const touched: string[] = [];
    if (dto.individual === undefined && dto.company === undefined
        && !dto.factory && !dto.free_facility) {
      throw new BadRequestException('Send at least one tier to update');
    }

    const effectiveFrom = dto.effective_from
      ? new Date(dto.effective_from)
      : new Date();
    const graded = await this.productConditions.hasConditions(productId);
    const currency = await this.settings.defaultCurrency();

    // Flat tiers: one price each, whatever the material.
    const flat: Array<[PricingTier, number | undefined]> = [
      [PricingTier.INDIVIDUAL, dto.individual],
      [PricingTier.COMPANY, dto.company],
    ];
    for (const [tier, price] of flat) {
      if (price === undefined) continue;
      await this.archiveCurrent(productId, tier, PricingArchiveReason.UPDATED, adminId);
      await this.insertCurrent(productId, tier, price, currency, effectiveFrom, null);
      touched.push(tier);
    }

    // Graded tiers: shape validated against the material's own conditions.
    const gradedTiers: Array<[PricingTier, ConditionPriceDto[] | undefined]> = [
      [PricingTier.FACTORY, dto.factory],
      [PricingTier.FREE_FACILITY, dto.free_facility],
    ];
    const linesByTier = new Map<PricingTier, ConditionLine[]>();
    for (const [tier, lines] of gradedTiers) {
      if (!lines) continue;
      const normalized = await this.normalizeConditionLines(
        lines, productId, tier, graded);
      await this.archiveCurrent(productId, tier, PricingArchiveReason.UPDATED, adminId);
      for (const line of normalized) {
        await this.insertCurrent(
          productId, tier, line.price, currency, effectiveFrom, line.condition, line.conditionId);
      }
      linesByTier.set(tier, normalized);
      touched.push(tier);
    }

    // Open baskets follow the new price; placed orders never do.
    const updatedCarts = await this.repriceActiveCarts(productId, {
      [PricingTier.INDIVIDUAL]:
        dto.individual ?? (await this.currentFlatPrice(productId, PricingTier.INDIVIDUAL)),
      [PricingTier.COMPANY]:
        dto.company ?? (await this.currentFlatPrice(productId, PricingTier.COMPANY)),
      [PricingTier.FACTORY]: toPriceMap(
        linesByTier.get(PricingTier.FACTORY)
          ?? (await this.currentConditionLines(productId, PricingTier.FACTORY))),
      [PricingTier.FREE_FACILITY]: toPriceMap(
        linesByTier.get(PricingTier.FREE_FACILITY)
          ?? (await this.currentConditionLines(productId, PricingTier.FREE_FACILITY))),
    });

    // Odoo prices its warehouse orders from these, and the catalogue caches
    // them, so both are told immediately rather than left to drift.
    // The price just moved, so every offer on this material has to be
    // re-derived against it: the stored percentage is now wrong, and an
    // amount that no longer fits would make the price NEGATIVE. Done BEFORE
    // the push so Odoo receives the corrected picture, not the broken one.
    await this.offerSettlement.resettle(productId, adminId);
    await this.odooSync.enqueueUpdatePricing({ productId });
    // 'offers' too, not only 'products': the offers listing shows each offer's
    // price and percentage DERIVED from the material's base price, so a price
    // change leaves those figures stale in the cached offers page unless it is
    // dropped here as well. This was the bug where editing a price left the
    // offers route serving the old numbers.
    await this.cache.invalidate('products', 'offers');
    await this.audit.record({
      userId: adminId,
      action: 'UPDATE_PRICING_TABLE',
      entityType: 'product_pricing',
      entityId: productId,
      newValues: { tiers: touched, effectiveFrom },
    });

    return {
      message: 'Pricing updated successfully',
      product_id: productId,
      updated_tiers: touched,
      updated_cart_items: updatedCarts,
      effective_from: effectiveFrom,
      pricing: await this.livePricingView(productId),
    };
  }
  // ---------------------------------------------------------------------------
  // Single-tier edit
  // ---------------------------------------------------------------------------
  /**
   * Updates ONE price and leaves everything else untouched.
   *
   * Whether a condition must be named is decided by the MATERIAL, not the tier:
   *
   *   graded material + FACTORY/FREE_FACILITY → the condition is REQUIRED, and
   *     must be one this material actually has. Without it the caller is asking
   *     to change "the factory price" of something that has four of them, and
   *     the system would have to guess which.
   *   ungraded material, or INDIVIDUAL/COMPANY → there is a single price, so a
   *     condition is refused rather than silently ignored — accepting it would
   *     let an admin believe they changed one grade when they changed the lot.
   */
  async updateTierPrice(
    adminId: string,
    productId: string,
    tier: PricingTier,
    dto: UpdateTierPriceDto,
  ) {
    const product = await this.productOrThrow(productId);

    const graded = await this.productConditions.hasConditions(productId);
    const perCondition = isPricedPerCondition(tier, graded);
    let conditionCode: string | null = null;
    let conditionId: string | null = null;

    if (perCondition) {
      // The grade is named by ID. A code is unique only within its material —
      // "GOOD" is a different grade for paper than for copper — so an id is
      // the only thing that names one grade for certain. The code is still
      // accepted for callers written before the link existed.
      if (dto.condition_id) {
        const condition = await this.productConditions.resolveForProduct(
          dto.condition_id,
          productId,
        );
        if (dto.condition && dto.condition.trim().toUpperCase() !== condition.code) {
          // Refused rather than resolved by precedence: either could have been
          // the caller's intent, and quietly picking one is how a grade gets
          // priced as another.
          throw new BadRequestException(
            `condition_id refers to "${condition.code}" but condition says "${dto.condition}". Send one, or send both agreeing.`,
          );
        }
        conditionId = condition.id;
        conditionCode = condition.code;
      } else if (dto.condition) {
        const code = dto.condition.trim().toUpperCase();
        const allowed = await this.productConditions.activeCodes(productId);
        if (!allowed.includes(code)) {
          throw new BadRequestException(
            `"${code}" is not a condition of this material — it has: ${allowed.join(', ')}`,
          );
        }
        conditionCode = code;
        // Resolved to the row so the link is written too — a caller that still
        // speaks in codes must not leave the price unlinked.
        const row = await this.productConditions.findByCodeForProduct(
          productId, code);
        conditionId = row?.id ?? null;
      } else {
        throw new ConditionRequiredException();
      }
    } else if (dto.condition || dto.condition_id) {
      // An UNGRADED material has no grade to price against, and neither does
      // the INDIVIDUAL or COMPANY tier — sending one means the caller believes
      // something about this material that is not true.
      throw new BadRequestException(describeExpectedShape(tier, graded));
    }

    const effectiveFrom = dto.effective_from ? new Date(dto.effective_from) : new Date();
    const currency = await this.settings.defaultCurrency();

    await this.archiveCurrent(productId, tier, PricingArchiveReason.UPDATED, adminId, conditionCode);
    const inserted = await this.insertCurrent(
      productId, tier, dto.price, currency, effectiveFrom, conditionCode, conditionId,
    );

    const updatedCarts = await this.repriceTier(productId, tier, dto.price, conditionCode);
    // The price just moved, so every offer on this material has to be
    // re-derived against it: the stored percentage is now wrong, and an
    // amount that no longer fits would make the price NEGATIVE. Done BEFORE
    // the push so Odoo receives the corrected picture, not the broken one.
    await this.offerSettlement.resettle(productId, adminId);
    await this.odooSync.enqueueUpdatePricing({ productId });
    await this.audit.record({
      userId: adminId,
      action: 'UPDATE_TIER_PRICING',
      entityType: 'product_pricing',
      entityId: productId,
      newValues: { tier, condition: conditionCode, price: dto.price, effectiveFrom },
    });
    // 'offers' too, not only 'products': the offers listing shows each offer's
    // price and percentage DERIVED from the material's base price, so a price
    // change leaves those figures stale in the cached offers page unless it is
    // dropped here as well. This was the bug where editing a price left the
    // offers route serving the old numbers.
    await this.cache.invalidate('products', 'offers');

    return {
      product_id: productId,
      pricing_id: inserted.id,
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
  /**
   * Withdraws a material's whole price list.
   *
   * The material is not deleted — it is SUSPENDED. With no live price it stops
   * being visible to every buyer role at once (the catalogue only shows what a
   * tier can actually be charged for), it cannot be added to a basket, and a
   * basket that already holds it is refused by name at checkout.
   *
   * The empty list is pushed to Odoo too, so its price sheet says the list was
   * withdrawn and the material is suspended — rather than showing a material
   * with no prices and leaving the warehouse to guess.
   */
  async deletePricing(adminId: string, productId: string, tiers?: PricingTier[]) {
    const product = await this.productOrThrow(productId);

    // No tiers (or empty) means withdraw EVERY role's price (full suspension).
    // A specific set withdraws only those roles, leaving the material sellable
    // to the ones still priced.
    const targetTiers =
      tiers && tiers.length > 0 ? tiers : (Object.values(PricingTier) as PricingTier[]);

    let archived = 0;
    for (const tier of targetTiers) {
      const rows = await this.archiveCurrent(productId, tier, PricingArchiveReason.DELETED, adminId);
      archived += rows.length;
    }

    if (archived === 0) {
      throw new BadRequestException(
        tiers && tiers.length > 0
          ? 'None of the chosen roles have an active price to delete'
          : 'Product has no active pricing to delete',
      );
    }

    await this.audit.record({
      userId: adminId,
      action: 'DELETE_PRICING',
      entityType: 'product_pricing',
      entityId: productId,
      oldValues: { archived_rows: archived },
    });
    // 'offers' too, not only 'products': the offers listing shows each offer's
    // price and percentage DERIVED from the material's base price, so a price
    // change leaves those figures stale in the cached offers page unless it is
    // dropped here as well. This was the bug where editing a price left the
    // offers route serving the old numbers.
    await this.cache.invalidate('products', 'offers');
    // Clears the mirrored price rows in Odoo, which is what makes its price
    // sheet show the material as suspended.
    // The price just moved, so every offer on this material has to be
    // re-derived against it: the stored percentage is now wrong, and an
    // amount that no longer fits would make the price NEGATIVE. Done BEFORE
    // the push so Odoo receives the corrected picture, not the broken one.
    await this.offerSettlement.resettle(productId, adminId);
    await this.odooSync.enqueueUpdatePricing({ productId });

    return {
      product_id: productId,
      archived_rows: archived,
      suspended: true,
      message:
        'Price list withdrawn — this material is suspended and hidden from all buyer roles until a new list is added',
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
    const product = await this.productOrThrow(productId);

    const rows = await this.pricingRepo.find({ where: { productId } });

    // Grades belong to the material, so their names are resolved per material —
    // two materials may both have a "GOOD" and they are different grades.
    const labels = await this.conditions.labelMapFor([productId]);

    // The flat tiers (citizen / institution) as a ROW, not a bare number, so the
    // caller gets the pricing-row id it needs to edit or correct that exact row —
    // the same id the graded tiers already expose. `null` when the role is
    // unpriced, which is real information, not a gap.
    const flatTier = (tier: PricingTier) => {
      const row = rows.find((r) => r.tier === tier && !r.conditionCode);
      return row
        ? {
            pricing_id: row.id,
            price: Number(row.price),
            currency: row.currency,
            effective_from: row.effectiveFrom,
            effective_until: row.effectiveUntil ?? null,
          }
        : null;
    };

    /**
     * The FACTORY and FREE_FACILITY tiers, as they actually are.
     *
     * These came back as empty arrays for every UNGRADED material, and the
     * cause was a filter that assumed they are always priced per grade: rows
     * for a material with no grades carry `conditionCode = null`, and
     * `.filter(r => r.conditionCode)` dropped exactly those. A factory looking
     * at a priced material saw no price and no reason for it.
     *
     * "Ungraded" is a real and common answer, not a missing setup step — so the
     * ungraded row is returned with `condition: null`, in the same array shape
     * as a graded one. One shape means a client reads both without knowing
     * which kind of material it asked about.
     */
    const tierPrices = (tier: PricingTier) =>
      rows
        .filter((r) => r.tier === tier)
        .map((r) => ({
          pricing_id: r.id,
          condition_id: r.conditionId ?? null,
          condition: r.conditionCode ?? null,
          condition_name:
            (r.conditionCode
              ? labels.get(`${productId}:${r.conditionCode}`)
              : null) ?? null,
          price: Number(r.price),
          currency: r.currency,
          effective_from: r.effectiveFrom,
          effective_until: r.effectiveUntil ?? null,
        }));

    return {
      product_id: productId,
      pricing: {
        individual: flatTier(PricingTier.INDIVIDUAL),
        company: flatTier(PricingTier.COMPANY),
        factory: tierPrices(PricingTier.FACTORY),
        free_facility: tierPrices(PricingTier.FREE_FACILITY),
      },
    };
  }

  /**
   * Correct ONE live price row, by its own id.
   *
   * Different from the tier routes on purpose. Those replace a tier's price:
   * they archive what was there and open a new row, because a price CHANGE is
   * a new fact with its own start date, and a delivery quoted last month was
   * quoted at last month's rate. This is the other case — the number that was
   * typed was simply wrong — so it corrects the row in place and leaves no
   * phantom "price change" in the history that never happened commercially.
   *
   * Only a LIVE row may be corrected. A superseded one is what orders were
   * actually priced at, and rewriting it would make every past invoice
   * unexplainable to the buyer who paid it.
   */
  async correctPricingRow(
    adminId: string,
    pricingId: string,
    dto: { price: number },
  ) {
    const row = await this.pricingRepo.findOne({ where: { id: pricingId } });
    if (!row) throw new NotFoundException('Price row not found');

    if (dto.price === undefined) {
      throw new BadRequestException('Send a price to correct');
    }

    if (!this.isLive(row.effectiveFrom, row.effectiveUntil)) {
      throw new BadRequestException(
        'Only the price currently in force can be corrected — a superseded price is what orders were actually charged at',
      );
    }

    // Currency is never corrected here — it is the central platform setting, not
    // a per-row value. Only the typed-wrong figure is fixed.
    const before = { price: Number(row.price) };
    row.price = String(dto.price);
    await this.pricingRepo.save(row);

    // The figure moved, so carts holding this material at the old figure follow
    // it (or the buyer checks out at a number the catalogue no longer shows),
    // and every offer on the material is re-settled against the new base.
    const updatedCarts = await this.repriceTier(
      row.productId, row.tier, dto.price, row.conditionCode ?? null,
    );
    await this.offerSettlement.resettle(row.productId, adminId);
    // Odoo prices from these rows and the catalogue caches them, so the
    // correction is pushed and the caches dropped.
    await this.odooSync.enqueueUpdatePricing({ productId: row.productId });
    await this.audit.record({
      userId: adminId,
      action: 'CORRECT_PRICING_ROW',
      entityType: 'product_pricing',
      entityId: row.id,
      oldValues: before,
      newValues: { price: dto.price },
    });
    // 'offers' too, not only 'products': the offers listing shows each offer's
    // price and percentage DERIVED from the material's base price, so a price
    // change leaves those figures stale in the cached offers page unless it is
    // dropped here as well. This was the bug where editing a price left the
    // offers route serving the old numbers.
    await this.cache.invalidate('products', 'offers');

    return {
      message: 'Price corrected successfully',
      pricing_id: row.id,
      product_id: row.productId,
      tier: row.tier.toLowerCase(),
      condition_id: row.conditionId ?? null,
      condition: row.conditionCode ?? null,
      price: Number(row.price),
      currency: row.currency,
      updated_cart_items: updatedCarts,
    };
  }

  // Per-product currency re-denomination was removed: currency is a single
  // central setting (PlatformSettingsService), never set per product. See
  // PATCH /v1/admin/platform-settings.

  /**
   * Give the material's live prices an end date.
   *
   * A price list that stops on a known day is a normal commercial act — a
   * seasonal rate, a contract ending — and it is NOT the same as deleting the
   * list. Deleting suspends the material immediately and pulls it from every
   * catalogue; this leaves it sellable until the date arrives and then stops.
   *
   * The date must be in the future. Back-dating an expiry would retroactively
   * un-price orders that were already placed and priced.
   */
  async expireCurrentPricing(
    adminId: string,
    productId: string,
    effectiveUntil: Date,
    tiers?: PricingTier[],
  ) {
    const product = await this.productOrThrow(productId);

    if (effectiveUntil.getTime() <= Date.now()) {
      throw new BadRequestException(
        'The expiry date must be in the future — back-dating it would un-price orders that were already placed',
      );
    }

    // No tiers (or an empty list) means "all roles". A specific set expires only
    // those roles/tiers and leaves the rest sellable.
    const scoped = tiers && tiers.length > 0;
    const rows = await this.pricingRepo.find({
      where: scoped ? { productId, tier: In(tiers) } : { productId },
    });
    const live = rows.filter((r) => this.isLive(r.effectiveFrom, r.effectiveUntil));
    if (!live.length) {
      throw new BadRequestException(
        'This material has no live price to expire',
      );
    }

    for (const row of live) {
      row.effectiveUntil = effectiveUntil;
    }
    await this.pricingRepo.save(live);

    // The price just moved, so every offer on this material has to be
    // re-derived against it: the stored percentage is now wrong, and an
    // amount that no longer fits would make the price NEGATIVE. Done BEFORE
    // the push so Odoo receives the corrected picture, not the broken one.
    await this.offerSettlement.resettle(productId, adminId);
    await this.odooSync.enqueueUpdatePricing({ productId });
    await this.audit.record({
      userId: adminId,
      action: 'EXPIRE_PRICING',
      entityType: 'product_pricing',
      entityId: productId,
      newValues: { tiers: scoped ? tiers : 'ALL', effectiveUntil },
    });
    // 'offers' too, not only 'products': the offers listing shows each offer's
    // price and percentage DERIVED from the material's base price, so a price
    // change leaves those figures stale in the cached offers page unless it is
    // dropped here as well. This was the bug where editing a price left the
    // offers route serving the old numbers.
    await this.cache.invalidate('products', 'offers');

    return {
      message: 'Pricing expiry set successfully',
      product_id: productId,
      tiers: scoped ? tiers!.map((t) => t.toLowerCase()) : 'all',
      effective_until: effectiveUntil,
      rows_affected: live.length,
    };
  }

  /**
   * Sweep of price rows whose admin-set expiry has ARRIVED.
   *
   * An expiry set by {@link expireCurrentPricing} only marks the row with a
   * future `effectiveUntil`; the row stays in the live table until that instant
   * passes. This sweep is what acts when it does: it finds every current row
   * whose end has come and gone, ARCHIVES it out of `product_pricing` (reason
   * EXPIRED — it must NOT linger in the live table), and NOTIFIES the admins so
   * they know the material has just fallen out of every buyer catalogue and
   * needs re-pricing.
   *
   * Grouped per material so Odoo is pushed once and one notification is sent for
   * the whole material, not one per grade. Idempotent: rows are removed as they
   * are swept, so a second run finds nothing.
   *
   * Called by the expiry cron (worker process). Returns a small summary for
   * logging / tests.
   */
  async sweepExpiredPricing(adminId = 'system'): Promise<{
    products: number;
    rows: number;
  }> {
    const now = new Date();
    // Live rows (they are all live — the table holds only current prices) whose
    // end date has already passed.
    const expired = await this.pricingRepo
      .createQueryBuilder('pp')
      .where('pp.effectiveUntil IS NOT NULL')
      .andWhere('pp.effectiveUntil <= :now', { now })
      .getMany();

    if (expired.length === 0) return { products: 0, rows: 0 };

    // Group the expired rows by material.
    const byProduct = new Map<string, ProductPricing[]>();
    for (const row of expired) {
      (byProduct.get(row.productId) ??
        byProduct.set(row.productId, []).get(row.productId)!).push(row);
    }

    let rowCount = 0;
    for (const [productId, rows] of byProduct) {
      // Archive then remove — the row leaves the live table for the history.
      const archivedAt = new Date();
      await this.historyRepo.save(
        rows.map((r) =>
          this.historyRepo.create({
            productId: r.productId,
            tier: r.tier,
            conditionCode: r.conditionCode ?? null,
            price: r.price,
            currency: r.currency,
            effectiveFrom: r.effectiveFrom,
            archivedAt,
            archivedReason: PricingArchiveReason.EXPIRED,
            archivedBy: adminId,
          }),
        ),
      );
      await this.pricingRepo.remove(rows);
      rowCount += rows.length;

      // The material may now be unpriced for some/all roles; offers derived from
      // those prices must be re-settled, and Odoo told the prices are gone.
      await this.offerSettlement.resettle(productId, adminId).catch(() => undefined);
      await this.odooSync.enqueueUpdatePricing({ productId }).catch(() => undefined);

      const product = await this.productRepo.findOne({ where: { id: productId } });
      await this.notifyAdminsPricingExpired(product?.id ?? productId, product?.name ?? productId);
    }

    await this.cache.invalidate('products', 'offers');
    return { products: byProduct.size, rows: rowCount };
  }

  /**
   * Tell every admin a material's pricing has expired and it has dropped out of
   * the buyer catalogues until it is re-priced. Best-effort — a notification
   * failure must never abort the sweep that already archived the rows.
   */
  private async notifyAdminsPricingExpired(productId: string, productName: string): Promise<void> {
    try {
      const admins = await this.accountRepo.find({ where: { role: Role.ADMIN } });
      for (const admin of admins) {
        const n = await this.notifications.createNotification({
          userId: admin.id,
          title: 'Material pricing expired',
          body: `Pricing for "${productName}" has expired — it is hidden from buyers until you re-price it.`,
          titleKey: 'Material pricing expired',
          bodyKey: 'Pricing for a material has expired and it is hidden from buyers until re-priced',
          args: { name: productName },
          type: NotificationType.GENERAL,
          metadata: { productId },
        });
        await this.notifications.enqueueNotification(n.id);
      }
    } catch {
      // swallowed on purpose — see doc comment
    }
  }

  /** Previous (archived) prices grouped per tier, newest first. */
  async getPriceHistory(
    productId: string,
    options: { as_of?: string; page?: number; limit?: number } = {},
  ) {
    const product = await this.productOrThrow(productId);

    const labels = await this.conditions.labelMapFor([productId]);

    // ── What was in force ON A GIVEN DAY ───────────────────────────────
    //
    // Asked as a question about a date, not about a row: "what did we charge
    // factories on 3 March?" A price was in force on a date when it started on
    // or before it and had not yet ended — which is one rule applied to the
    // live table AND the archive together, because a price still in force today
    // was also in force last month and lives in the live table, not the
    // history. Reading only the archive is what made this look empty.
    const asOf = options.as_of ? new Date(options.as_of) : null;

    const [liveRows, archivedRows] = await Promise.all([
      this.pricingRepo.find({ where: { productId } }),
      this.historyRepo.find({ where: { productId }, order: { archivedAt: 'DESC' } }),
    ]);

    const shape = (r: any, archived: boolean) => ({
      pricing_id: r.id,
      status: archived ? 'ARCHIVED' : 'LIVE',
      condition_id: r.conditionId ?? null,
      condition: r.conditionCode ?? null,
      condition_name:
        (r.conditionCode ? labels.get(`${productId}:${r.conditionCode}`) : null) ?? null,
      price: Number(r.price),
      // The currency the price is QUOTED in. Copied onto each row rather than
      // read from a setting, so a row always reports the currency it was
      // actually agreed in even after the platform default changes.
      currency: r.currency,
      effective_from: r.effectiveFrom,
      effective_until: archived ? (r.archivedAt ?? null) : (r.effectiveUntil ?? null),
      archived_at: archived ? r.archivedAt : null,
      archived_reason: archived ? r.archivedReason : null,
    });

    const inForceOn = (from: Date, until: Date | null | undefined, at: Date) =>
      new Date(from).getTime() <= at.getTime() &&
      (!until || new Date(until).getTime() > at.getTime());

    let entries = [
      ...liveRows.map((r) => shape(r, false)),
      ...archivedRows.map((r) => shape(r, true)),
    ];
    if (asOf) {
      entries = entries.filter((e) =>
        inForceOn(e.effective_from, e.effective_until, asOf),
      );
    }
    // Newest first: the question is almost always "what is it now, and what was
    // it just before".
    entries.sort(
      (a, b) =>
        new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime(),
    );

    // EVERY tier appears, including the ones with nothing. An absent key reads
    // as "this tier does not exist"; an empty array says "nothing here yet",
    // which is the true and useful answer.
    const tiers: Record<string, unknown[]> = {};
    for (const tier of Object.values(PricingTier)) {
      tiers[tier.toLowerCase()] = [];
    }
    // Grouped from the SOURCE rows, so a row's tier is never inferred from its
    // position in a sorted list.
    const tierOf = new Map<string, PricingTier>();
    liveRows.forEach((r) => tierOf.set(r.id, r.tier));
    archivedRows.forEach((r) => tierOf.set(r.id, r.tier));
    for (const entry of entries) {
      const tier = tierOf.get(entry.pricing_id);
      if (tier) tiers[tier.toLowerCase()].push(entry);
    }

    const page = Math.max(options.page ?? 1, 1);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const flat = entries.slice((page - 1) * limit, page * limit);

    return {
      product_id: productId,
      as_of: asOf ?? null,
      // Grouped per tier for a price sheet, and flat for a paged timeline —
      // the same rows read two ways rather than two endpoints that can drift.
      tiers,
      entries: flat,
      pagination: buildPagination(entries.length, page, limit),
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  /** Validates + uppercases condition codes and rejects duplicates in one list. */
  /**
   * Validates one tier's price lines against THIS material's own grades.
   *
   * The material decides the shape, not the tier:
   *   graded   → one line per grade, each naming a grade THIS material has
   *   ungraded → exactly one line, carrying no grade at all
   *
   * The ungraded case is the one that used to be wrong. With nothing to grade,
   * asking a factory for a price per condition asks for a value that does not
   * exist — so an ungraded material is priced once for every tier, factories
   * included, exactly like an individual buyer.
   */
  private async normalizeConditionLines(
    lines: ConditionPriceDto[],
    productId: string,
    tier: PricingTier,
    materialHasConditions: boolean,
  ): Promise<ConditionLine[]> {
    const perCondition = isPricedPerCondition(tier, materialHasConditions);

    if (!perCondition) {
      if (lines.length !== 1 || lines[0]?.condition || lines[0]?.condition_id) {
        throw new BadRequestException(
          describeExpectedShape(tier, materialHasConditions),
        );
      }
      return [{ condition: null, conditionId: null, price: lines[0].price }];
    }

    // Graded: every line must name a grade this material actually has —
    // preferably BY ID, since a code is unique only inside its own material
    // and one borrowed from another would price a grade nobody can order.
    const allowed = await this.productConditions.activeCodes(productId);
    const seen = new Set<string>();
    const out: ConditionLine[] = [];
    for (const line of lines) {
      let code: string;
      let conditionId: string | null;

      if (line.condition_id) {
        // The id names one row for good. Resolved against THIS material, so a
        // grade belonging to another is refused here rather than priced.
        const grade = await this.productConditions.resolveForProduct(
          line.condition_id,
          productId,
        );
        if (line.condition && line.condition.trim().toUpperCase() !== grade.code) {
          // Refused rather than settled by precedence: either could have been
          // the intent, and quietly picking one is how a grade gets priced as
          // another.
          throw new BadRequestException(
            `condition_id refers to "${grade.code}" but condition says "${line.condition}". Send one, or send both agreeing.`,
          );
        }
        code = grade.code;
        conditionId = grade.id;
      } else {
        code = (line.condition ?? '').trim().toUpperCase();
        if (!code) {
          throw new BadRequestException(
            describeExpectedShape(tier, materialHasConditions),
          );
        }
        if (!allowed.includes(code)) {
          throw new BadRequestException(
            `"${code}" is not a condition of this material — it has: ${allowed.join(', ')}`,
          );
        }
        // Resolved to the row so the link is written even for a caller that
        // still speaks in codes — a price left unlinked is one the grade can
        // be deleted out from under.
        const row = await this.productConditions.findByCodeForProduct(productId, code);
        conditionId = row?.id ?? null;
      }

      if (seen.has(code)) {
        throw new BadRequestException(
          `Duplicate condition "${code}" in the price list`,
        );
      }
      seen.add(code);
      out.push({ condition: code, conditionId, price: line.price });
    }

    // Every grade must be priced. A half-filled list leaves buyers unable to
    // order the grades the admin forgot, with nothing on screen to say why.
    const missing = allowed.filter((c) => !seen.has(c));
    if (missing.length) {
      throw new BadRequestException(
        `Missing a ${tier} price for: ${missing.join(', ')}`,
      );
    }
    return out;
  }
  /**
   * One price row in full, by its own id.
   *
   * Lets an admin screen open a single price without re-deriving it from the
   * whole table — and, because history rows carry the id of the row they
   * replaced, it is also how "what was this before?" is answered.
   */
  async getPricingById(pricingId: string) {
    const row = await this.pricingRepo.findOne({
      where: { id: pricingId },
      relations: ['product'],
    });
    if (!row) throw new NotFoundException('Price not found');

    const history = await this.historyRepo.find({
      where: { productId: row.productId, tier: row.tier },
      order: { archivedAt: 'DESC' },
      take: 10,
    });

    return {
      message: 'Price fetched successfully',
      price: {
        id: row.id,
        product: row.product
          ? { id: row.product.id, name: row.product.name }
          : { id: row.productId },
        tier: row.tier,
        // Null means the material has no conditions: this is its plain price.
        condition: row.conditionCode ?? null,
        price: Number(row.price),
        currency: row.currency,
        effective_from: row.effectiveFrom,
        effective_until: row.effectiveUntil ?? null,
        is_live: this.isLive(row.effectiveFrom, row.effectiveUntil),
        created_at: row.createdAt,
      },
      // The timeline the admin reviews: what this tier used to cost, why it
      // changed, and who changed it.
      history: history.map((h) => ({
        price: Number(h.price),
        condition: h.conditionCode ?? null,
        currency: h.currency,
        effective_from: h.effectiveFrom,
        // A history row has no end date of its own: it was superseded, and
        //  is exactly when it stopped applying.
        reason: h.archivedReason,
        archived_by: h.archivedBy ?? null,
        archived_at: h.archivedAt,
      })),
    };
  }

  /** The live price table of a material, in the shape the admin screen shows. */
  async livePricingView(productId: string) {
    const rows = await this.liveRows(productId);
    const flat = (tier: PricingTier) =>
      rows.find((r) => r.tier === tier && !r.conditionCode);
    const graded = (tier: PricingTier) =>
      rows
        .filter((r) => r.tier === tier)
        .map((r) => ({
          pricing_id: r.id,
          condition: r.conditionCode ?? null,
          price: Number(r.price),
        }));

    return {
      individual: flat(PricingTier.INDIVIDUAL)
        ? {
            pricing_id: flat(PricingTier.INDIVIDUAL)!.id,
            price: Number(flat(PricingTier.INDIVIDUAL)!.price),
          }
        : null,
      company: flat(PricingTier.COMPANY)
        ? {
            pricing_id: flat(PricingTier.COMPANY)!.id,
            price: Number(flat(PricingTier.COMPANY)!.price),
          }
        : null,
      factory: graded(PricingTier.FACTORY),
      free_facility: graded(PricingTier.FREE_FACILITY),
    };
  }

  /** Every price of a material that is effective right now. */
  private async liveRows(productId: string): Promise<ProductPricing[]> {
    return this.pricingRepo
      .createQueryBuilder('pp')
      .where('pp.productId = :productId', { productId })
      .andWhere('pp.effectiveFrom <= NOW()')
      .andWhere('(pp.effectiveUntil IS NULL OR pp.effectiveUntil > NOW())')
      .orderBy('pp.tier', 'ASC')
      .addOrderBy('pp.conditionCode', 'ASC')
      .getMany();
  }

  /**
   * The current single price of a flat tier.
   *
   * Needed when re-pricing carts after a PARTIAL edit: a tier the caller did
   * not touch must keep charging what it charges, and passing 0 would silently
   * zero every open basket of that tier.
   */
  private async currentFlatPrice(
    productId: string,
    tier: PricingTier,
  ): Promise<number> {
    const rows = await this.liveRows(productId);
    const row = rows.find((r) => r.tier === tier && !r.conditionCode);
    return row ? Number(row.price) : 0;
  }

  /** The current per-condition lines of a graded tier, for the same reason. */
  private async currentConditionLines(
    productId: string,
    tier: PricingTier,
  ): Promise<ConditionLine[]> {
    const rows = await this.liveRows(productId);
    return rows
      .filter((r) => r.tier === tier)
      .map((r) => ({
        condition: r.conditionCode ?? null,
        // Read back off the stored row, so a line carried forward keeps the
        // link it was written with rather than silently losing it.
        conditionId: r.conditionId ?? null,
        price: Number(r.price),
      }));
  }

  private isLive(from: Date, until?: Date | null): boolean {
    const now = Date.now();
    return (
      new Date(from).getTime() <= now &&
      (until == null || new Date(until).getTime() > now)
    );
  }

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
    conditionId: string | null = null,
  ): Promise<ProductPricing> {
    return this.pricingRepo.save(
      this.pricingRepo.create({
        productId,
        tier,
        // Both written together, always. `conditionId` is the link;
        // `conditionCode` is the denormalised label Odoo and the cart read, and
        // letting the two drift would mean a price attached to one grade and
        // labelled as another.
        conditionId,
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
    // A material with no conditions has one plain price for the whole tier, so
    // an item carrying no condition code still prices correctly.
    if (!conditionCode) return map.get(PLAIN_PRICE_KEY) ?? null;
    return map.get(conditionCode) ?? map.get(PLAIN_PRICE_KEY) ?? null;
  }
}

/** condition code (or the plain-price key) → price, for cart re-pricing. */
function toPriceMap(lines: ConditionLine[]): Map<string, number> {
  return new Map(lines.map((l) => [l.condition ?? PLAIN_PRICE_KEY, l.price]));
}
