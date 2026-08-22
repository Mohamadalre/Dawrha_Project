import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { MaterialCondition } from '../entities/material-condition.entity';
import { Product } from '../entities/product.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { ProductPricingHistory } from '../entities/product-pricing-history.entity';
import { PricingArchiveReason } from '../enums/pricing-archive-reason.enum';
import { PricingTier } from '../enums/pricing-tier.enum';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { Offer } from '../entities/offer.entity';
import { OdooSyncStatus } from '../enums/odoo-sync-status.enum';
import { OfferAudience } from '../enums/offer-audience.enum';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { AuditService } from '../common/providers/audit.service';
import { CatalogCacheService } from '../common/providers/catalog-cache.service';

/**
 * The grades of ONE material.
 *
 * A material starts with none and may stay that way — "ungraded" is a real
 * answer, not an unfinished setup. That single fact decides how the material is
 * priced everywhere else:
 *
 *   graded   → FACTORY and FREE_FACILITY carry a price per grade
 *   ungraded → every role gets one price, factories included
 *
 * Order is assigned by the system, never taken from the request body. An order
 * the caller picks is an order two callers can collide on, and the sequence
 * would drift into duplicates nobody notices until a picker renders wrongly.
 * Repositioning is a separate, explicit operation.
 */
@Injectable()
export class ProductConditionsService {
  constructor(
    @InjectRepository(MaterialCondition)
    private readonly conditionRepo: Repository<MaterialCondition>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductPricing)
    private readonly pricingRepo: Repository<ProductPricing>,
    // A grade's live price is archived here before it is deleted with the grade.
    @InjectRepository(ProductPricingHistory)
    private readonly pricingHistoryRepo: Repository<ProductPricingHistory>,
    // Deleting a grade has to know whether any of it is still on a shelf.
    @InjectRepository(WarehouseInventory)
    private readonly inventoryRepo: Repository<WarehouseInventory>,
    // …and whether a live offer names it. The foreign key refuses that anyway;
    // this is here so the admin gets a sentence rather than a constraint error.
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    private readonly odooSync: OdooSyncService,
    private readonly audit: AuditService,
    private readonly cache: CatalogCacheService,
    private readonly dataSource: DataSource,
  ) {}

  /** The material's grades, in the order the admin arranged them. */
  async list(productId: string) {
    await this.productOrThrow(productId);
    const conditions = await this.conditionRepo.find({
      where: { productId },
      order: { sortOrder: 'ASC' },
    });
    return {
      message: 'Conditions fetched successfully',
      product_id: productId,
      // Explicit, because every pricing rule downstream turns on it.
      has_conditions: conditions.length > 0,
      conditions: conditions.map((c) => this.map(c)),
    };
  }

  /**
   * Adds a grade to a material.
   *
   * The position is `last + 1`, computed here — the caller does not send one.
   */
  async add(
    adminId: string,
    productId: string,
    dto: { code: string; name_en: string; name_ar: string },
  ) {
    const product = await this.productOrThrow(productId);

    const clash = await this.conditionRepo.findOne({
      where: { productId, code: dto.code },
    });
    if (clash) {
      throw new ConflictException(
        `This material already has a "${dto.code}" condition`,
      );
    }

    // Names must be unique within the material too — two grades sharing a name
    // (in either language) are indistinguishable to everyone who reads the list,
    // even when their codes differ. Case-insensitive so "Good" and "good" clash.
    const nameClash = await this.conditionRepo
      .createQueryBuilder('c')
      .where('c.productId = :productId', { productId })
      .andWhere(
        '(LOWER(c.nameEn) = LOWER(:nameEn) OR LOWER(c.nameAr) = LOWER(:nameAr))',
        { nameEn: dto.name_en.trim(), nameAr: dto.name_ar.trim() },
      )
      .getOne();
    if (nameClash) {
      throw new ConflictException(
        'This material already has a condition with that name',
      );
    }

    const last = await this.conditionRepo
      .createQueryBuilder('c')
      .select('COALESCE(MAX(c.sortOrder), 0)', 'max')
      .where('c.productId = :productId', { productId })
      .getRawOne<{ max: string }>();

    const condition = await this.conditionRepo.save(
      this.conditionRepo.create({
        productId,
        code: dto.code,
        nameEn: dto.name_en,
        nameAr: dto.name_ar,
        sortOrder: Number(last?.max ?? 0) + 1,
        odooSyncStatus: OdooSyncStatus.PENDING,
      }),
    );

    // Adding a grade turns an ungraded material into a graded one, and a graded
    // material is priced PER GRADE for the factory / free-facility tiers (the
    // BUYERS audience). Two things set while the material had no grades are now
    // invalid and are swept out here:
    //
    //   • the CONDITIONLESS (base) factory / free-facility PRICE — a factory
    //     would otherwise keep being quoted one figure for a material the system
    //     now expects a price per grade for; and
    //   • any CONDITIONLESS BUYERS OFFER — it discounted that base price, which
    //     is gone, and a BUYERS offer never reached the sellers, so it now has
    //     no price to apply to for anyone and would show as an empty offer card.
    //
    // Individual / company (SELLERS) prices and offers are left ALONE: sellers
    // are never graded, so their conditionless price still stands and their
    // conditionless offer still applies. The admin re-prices — and re-offers —
    // each grade. Self-gating: once the first grade cleared these, later grade
    // adds find nothing to do.
    const graded = await this.demoteConditionlessGradedPricingAndOffers(
      adminId,
      productId,
    );

    await this.afterChange(adminId, 'ADD_PRODUCT_CONDITION', condition.id, {
      productId,
      code: condition.code,
    });
    await this.odooSync.enqueueSyncCondition({ conditionId: condition.id });
    // Rewrite Odoo's price sheet (it mirrors the offer-adjusted prices) when a
    // base price OR a conditionless buyers offer actually left it.
    if (graded) {
      await this.odooSync.enqueueUpdatePricing({ productId });
    }

    // Non-blocking warning: physical stock that is still UNGRADED does not
    // belong to any grade, so once the material is graded that stock is neither
    // visible under a grade nor sellable until a warehouse SORTS it into the new
    // grades. Adding the grade is NOT refused for it — the grade has to exist
    // before the warehouse can sort into it — but the admin is told, so the
    // stranded quantity is not silently forgotten.
    const ungradedQty = await this.ungradedStockQuantity(product);

    return {
      message: 'Condition added successfully',
      condition: this.map(condition),
      ...(ungradedQty > 0
        ? {
            warning:
              'This material still holds ungraded warehouse stock. It must be sorted into grades (in the warehouse) before it can be sold.',
            ungraded_stock_quantity: ungradedQty,
          }
        : {}),
    };
  }

  /**
   * Total PHYSICAL quantity of a material that is still UNGRADED — held under no
   * real grade (a null/empty code, or the `UNGRADED` bucket). Summed across
   * every warehouse. Zero for a material never synced to Odoo (no stock lines).
   */
  private async ungradedStockQuantity(product: Product): Promise<number> {
    if (!product.odooProductId) return 0;
    const row = await this.inventoryRepo
      .createQueryBuilder('i')
      .select('COALESCE(SUM(i.quantity), 0)', 'total')
      .where('i.odooProductId = :odooProductId', {
        odooProductId: product.odooProductId,
      })
      .andWhere(
        "(i.conditionCode IS NULL OR i.conditionCode = '' OR UPPER(i.conditionCode) = 'UNGRADED')",
      )
      .andWhere('i.quantity > 0')
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  /**
   * When a material becomes graded, removes the now-invalid CONDITIONLESS
   * factory / free-facility base PRICE (archived first) AND any CONDITIONLESS
   * BUYERS OFFER (which discounted that gone price). Returns true when anything
   * was actually removed, so the caller knows whether Odoo needs a rewrite.
   *
   * SELLERS prices and offers (citizen / institution) are untouched — those
   * tiers are never priced per grade, so their conditionless rows stay valid.
   */
  private async demoteConditionlessGradedPricingAndOffers(
    adminId: string,
    productId: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const pricingRepo = manager.getRepository(ProductPricing);
      const historyRepo = manager.getRepository(ProductPricingHistory);
      const offerRepo = manager.getRepository(Offer);

      const baseRows = await pricingRepo.find({
        where: [
          { productId, conditionId: IsNull(), tier: PricingTier.FACTORY },
          { productId, conditionId: IsNull(), tier: PricingTier.FREE_FACILITY },
        ],
      });
      if (baseRows.length) {
        await historyRepo.save(
          baseRows.map((p) =>
            historyRepo.create({
              productId: p.productId,
              tier: p.tier,
              conditionCode: p.conditionCode,
              price: p.price,
              currency: p.currency,
              effectiveFrom: p.effectiveFrom,
              archivedReason: PricingArchiveReason.GRADED,
              archivedBy: adminId,
            }),
          ),
        );
        await pricingRepo.remove(baseRows);
      }

      // Conditionless BUYERS offers only. A cart line that used one has its
      // offer_id nulled by the FK; SELLERS offers are never conditionless-graded
      // so they are not matched here.
      const baselessOffers = await offerRepo.find({
        where: {
          productId,
          conditionId: IsNull(),
          audience: OfferAudience.BUYERS,
        },
      });
      if (baselessOffers.length) {
        await offerRepo.remove(baselessOffers);
      }

      return baseRows.length > 0 || baselessOffers.length > 0;
    });
  }

  /**
   * Moves a grade to an explicit position, shifting the others to make room.
   *
   * The whole material's grades are renumbered inside ONE transaction. Shifting
   * row by row would leave the sequence briefly holding two grades at the same
   * position, and anything reading it in that window renders the wrong order.
   */
  async reorder(
    adminId: string,
    conditionId: string,
    position: number,
    expectedProductId?: string,
  ) {
    if (position < 1) {
      throw new BadRequestException('Position starts at 1');
    }

    const condition = await this.conditionOrThrow(conditionId, expectedProductId);

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(MaterialCondition);
      const siblings = await repo.find({
        where: { productId: condition.productId },
        order: { sortOrder: 'ASC' },
      });

      // Rebuild the list with the grade at its new index, then renumber from 1.
      // Deriving the sequence from an array rather than patching offsets makes
      // gaps and duplicates impossible by construction.
      const without = siblings.filter((c) => c.id !== conditionId);
      const target = Math.min(position, without.length + 1) - 1;
      without.splice(target, 0, condition);

      for (let i = 0; i < without.length; i++) {
        without[i].sortOrder = i + 1;
        without[i].odooSyncStatus = OdooSyncStatus.PENDING;
      }
      await repo.save(without);
    });

    await this.afterChange(adminId, 'REORDER_PRODUCT_CONDITION', conditionId, {
      productId: condition.productId,
      position,
    });
    // Odoo shows grades in this order to the sorter, so it has to follow.
    const all = await this.conditionRepo.find({
      where: { productId: condition.productId },
      order: { sortOrder: 'ASC' },
    });
    for (const c of all) {
      await this.odooSync.enqueueSyncCondition({ conditionId: c.id });
    }

    return {
      message: 'Conditions reordered successfully',
      conditions: all.map((c) => this.map(c)),
    };
  }

  async update(
    adminId: string,
    conditionId: string,
    dto: { name_en?: string; name_ar?: string; is_active?: boolean },
    expectedProductId?: string,
  ) {
    const condition = await this.conditionOrThrow(conditionId, expectedProductId);

    // Deactivating a grade HIDES it, it does not strand it. An inactive grade
    // keeps its price row (so reactivating restores exactly what it was) but
    // drops out of every buyer catalogue and out of Odoo's price sheet — only
    // the admin still sees it. So a price is NOT a reason to refuse the toggle;
    // the visibility everywhere else is what changes, and the Odoo push below
    // is what makes the price disappear there. (Pricing an INACTIVE grade is
    // blocked at the pricing route, so this can never activate a hidden price.)
    const activeChanged =
      dto.is_active !== undefined && dto.is_active !== condition.isActive;

    if (dto.name_en !== undefined) condition.nameEn = dto.name_en;
    if (dto.name_ar !== undefined) condition.nameAr = dto.name_ar;
    if (dto.is_active !== undefined) condition.isActive = dto.is_active;
    condition.odooSyncStatus = OdooSyncStatus.PENDING;
    const saved = await this.conditionRepo.save(condition);

    await this.afterChange(adminId, 'UPDATE_PRODUCT_CONDITION', saved.id, dto);
    await this.odooSync.enqueueSyncCondition({ conditionId: saved.id });
    // Activating or deactivating a grade changes whether its price belongs on
    // the Odoo sheet, so rewrite it — the push filters inactive grades out.
    if (activeChanged) {
      await this.odooSync.enqueueUpdatePricing({ productId: saved.productId });
    }
    return { message: 'Condition updated successfully', condition: this.map(saved) };
  }

  /**
   * Removes a grade.
   *
   * STOCK is the one hard blocker — and it is checked across EVERY warehouse,
   * not one. A grade with material still on any shelf cannot be deleted:
   * deleting it would leave real, physical stock labelled with a grade that no
   * longer exists — the warehouse can see it, the system cannot name it, and no
   * order can be raised to clear it. Reaching zero means selling it or moving it
   * to another grade (the transfer route exists precisely for the second).
   *
   * Its PRICE and OFFERS are NOT a blocker: they only ever pointed at this
   * grade, so they come down WITH it in one transaction. The live price is
   * archived to history first (the admin can still review what it was), and any
   * offer row is deleted (a cart that referenced it has its `offer_id` set null
   * by the FK). Placed orders are untouched — every order line froze the code,
   * the name and the price at checkout and reads none of these rows again.
   */
  async remove(adminId: string, conditionId: string, expectedProductId?: string) {
    const condition = await this.conditionOrThrow(conditionId, expectedProductId);

    const product = await this.productRepo.findOne({
      where: { id: condition.productId },
    });
    if (product?.odooProductId) {
      // SUM across ALL warehouse_inventory rows for this material + grade — no
      // warehouse filter, so a grade held in any single warehouse blocks it.
      const held = await this.inventoryRepo
        .createQueryBuilder('i')
        .select('COALESCE(SUM(i.quantity), 0)', 'total')
        .where('i.odooProductId = :odooProductId', {
          odooProductId: product.odooProductId,
        })
        .andWhere('i.conditionCode = :code', { code: condition.code })
        .getRawOne<{ total: string }>();

      const remaining = Number(held?.total ?? 0);
      if (remaining > 0) {
        // No numbers in the sentence: the error filter translates by exact
        // match on the whole message, so an interpolated quantity would reach
        // an Arabic caller in English.
        throw new ConflictException(
          'This condition still holds warehouse stock and cannot be deleted — sell it, or move it to another grade first',
        );
      }
    }

    // No stock: take the grade, its live price (archived first) and its offers
    // down together, atomically, and renumber the survivors 1..n.
    let hadLivePrice = false;
    await this.dataSource.transaction(async (manager) => {
      const pricingRepo = manager.getRepository(ProductPricing);
      const historyRepo = manager.getRepository(ProductPricingHistory);
      const offerRepo = manager.getRepository(Offer);
      const condRepo = manager.getRepository(MaterialCondition);

      const livePrices = await pricingRepo.find({
        where: { productId: condition.productId, conditionId: condition.id },
      });
      if (livePrices.length) {
        hadLivePrice = true;
        await historyRepo.save(
          livePrices.map((p) =>
            historyRepo.create({
              productId: p.productId,
              tier: p.tier,
              conditionCode: p.conditionCode,
              price: p.price,
              currency: p.currency,
              effectiveFrom: p.effectiveFrom,
              archivedReason: PricingArchiveReason.DELETED,
              archivedBy: adminId,
            }),
          ),
        );
        await pricingRepo.remove(livePrices);
      }

      // Offers point at the grade by id (FK RESTRICT), so they must go before
      // the grade. A cart line that used one has its offer_id nulled by the FK.
      await offerRepo.delete({ conditionId: condition.id });

      await condRepo.delete(conditionId);

      // Renumber what is left so the sequence stays 1..n with no hole.
      const rest = await condRepo.find({
        where: { productId: condition.productId },
        order: { sortOrder: 'ASC' },
      });
      rest.forEach((c, i) => (c.sortOrder = i + 1));
      if (rest.length) await condRepo.save(rest);
    });

    // Odoo cleanup. Rewrite the price sheet FIRST so the deleted grade's price
    // row leaves it (Odoo keys that row by code, not by a link to the grade),
    // THEN unlink the grade record so it also leaves the sorter's grade list.
    if (product?.odooProductId && hadLivePrice) {
      await this.odooSync.enqueueUpdatePricing({ productId: condition.productId });
    }
    if (condition.odooConditionId) {
      await this.odooSync.enqueueDeleteCondition({
        odooConditionId: condition.odooConditionId,
      });
    }
    await this.afterChange(adminId, 'DELETE_PRODUCT_CONDITION', conditionId, {
      productId: condition.productId,
      code: condition.code,
    });

    return { message: 'Condition deleted successfully' };
  }

  /** Does this material have grades? The question every pricing rule asks. */
  async hasConditions(productId: string): Promise<boolean> {
    return (
      (await this.conditionRepo.count({ where: { productId, isActive: true } })) > 0
    );
  }

  /** Active grade codes of a material, in display order. */
  async activeCodes(productId: string): Promise<string[]> {
    const rows = await this.conditionRepo.find({
      where: { productId, isActive: true },
      order: { sortOrder: 'ASC' },
    });
    return rows.map((r) => r.code);
  }

  /**
   * One grade by its own id, naming the material it belongs to.
   *
   * The material is included in the answer because it is the fact the id alone
   * does not carry, and the caller almost always needs it next — to show which
   * price list the grade sits in, or which sorting screen offers it.
   */
  async getOne(conditionId: string) {
    const condition = await this.conditionOrThrow(conditionId);
    const product = await this.productRepo.findOne({
      where: { id: condition.productId },
    });
    return {
      message: 'Condition fetched successfully',
      condition: {
        ...this.map(condition),
        product: product
          ? { id: product.id, name: product.name }
          : null,
      },
    };
  }

  /**
   * The grade, refusing it if it does not belong to the material in the path.
   *
   * A grade belongs to exactly ONE material, so the id alone is enough to find
   * it — which is precisely why the material segment was dangerous: it was
   * accepted, never checked, and therefore LIED. `/products/A/conditions/x`
   * happily edited a grade of material B, and the URL in the log said otherwise.
   *
   * Passing `expectedProductId` turns that segment back into a real assertion.
   * Omitting it is the id-only route, where there is nothing to disagree with.
   */
  /**
   * The grade row behind an id, asserted to belong to a material.
   *
   * Public because PRICING needs it: a price is attached to a grade by id, and
   * the grade has to be one of that material's own — pricing "GOOD" against
   * copper using the id of paper's "GOOD" would silently misprice every order.
   */
  async resolveForProduct(
    conditionId: string,
    productId: string,
  ): Promise<MaterialCondition> {
    return this.conditionOrThrow(conditionId, productId);
  }

  /**
   * The grade row behind a (material, code) pair.
   *
   * Only for callers that still speak in codes. A code is unique WITHIN its
   * material, so the material has to be part of the lookup — matching on the
   * code alone would find another material's grade of the same name.
   */
  async findByCodeForProduct(
    productId: string,
    code: string,
  ): Promise<MaterialCondition | null> {
    return this.conditionRepo.findOne({
      where: { productId, code: code.trim().toUpperCase() },
    });
  }

  private async conditionOrThrow(
    conditionId: string,
    expectedProductId?: string,
  ): Promise<MaterialCondition> {
    const condition = await this.conditionRepo.findOne({
      where: { id: conditionId },
    });
    if (!condition) throw new NotFoundException('Condition not found');

    if (expectedProductId && condition.productId !== expectedProductId) {
      // 400, not 404: the grade exists and the caller may well be allowed to
      // edit it — what is wrong is the pairing they asked for, and saying so is
      // what lets them fix the request instead of hunting a missing record.
      throw new BadRequestException(
        'This condition does not belong to that material — a condition belongs to exactly one material',
      );
    }
    return condition;
  }

  private async productOrThrow(productId: string): Promise<Product> {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private async afterChange(
    adminId: string,
    action: string,
    entityId: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      userId: adminId,
      action,
      entityType: 'material_condition',
      entityId,
      newValues: values,
    });
    // 'offers' as well as 'products': offers are made PER CONDITION, and the
    // offers listing shows each one's grade and grade-price — so adding,
    // renaming or removing a grade changes what that cached page should say,
    // and dropping only 'products' would leave the offers page stale.
    await this.cache.invalidate('products', 'offers');
  }

  private map(c: MaterialCondition) {
    return {
      id: c.id,
      product_id: c.productId,
      code: c.code,
      name_en: c.nameEn,
      name_ar: c.nameAr,
      sort_order: c.sortOrder,
      is_active: c.isActive,
    };
  }
}
