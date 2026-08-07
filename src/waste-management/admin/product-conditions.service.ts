import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { MaterialCondition } from '../entities/material-condition.entity';
import { Product } from '../entities/product.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { Offer } from '../entities/offer.entity';
import { OdooSyncStatus } from '../enums/odoo-sync-status.enum';
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
    await this.productOrThrow(productId);

    const clash = await this.conditionRepo.findOne({
      where: { productId, code: dto.code },
    });
    if (clash) {
      throw new ConflictException(
        `This material already has a "${dto.code}" condition`,
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

    await this.afterChange(adminId, 'ADD_PRODUCT_CONDITION', condition.id, {
      productId,
      code: condition.code,
    });
    await this.odooSync.enqueueSyncCondition({ conditionId: condition.id });

    return {
      message: 'Condition added successfully',
      condition: this.map(condition),
    };
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

    // Deactivating a grade that still carries a live price would strand that
    // price: the material would be priced for a grade nobody can order.
    if (dto.is_active === false && condition.isActive) {
      const priced = await this.pricingRepo.count({
        where: { productId: condition.productId, conditionCode: condition.code },
      });
      if (priced > 0) {
        throw new ConflictException(
          'This condition still has a price — remove it from the price list first',
        );
      }
    }

    if (dto.name_en !== undefined) condition.nameEn = dto.name_en;
    if (dto.name_ar !== undefined) condition.nameAr = dto.name_ar;
    if (dto.is_active !== undefined) condition.isActive = dto.is_active;
    condition.odooSyncStatus = OdooSyncStatus.PENDING;
    const saved = await this.conditionRepo.save(condition);

    await this.afterChange(adminId, 'UPDATE_PRODUCT_CONDITION', saved.id, dto);
    await this.odooSync.enqueueSyncCondition({ conditionId: saved.id });
    return { message: 'Condition updated successfully', condition: this.map(saved) };
  }

  /**
   * Removes a grade. Refused while it is priced or holds stock — deleting it
   * would leave both pointing at a grade that no longer exists.
   */
  async remove(adminId: string, conditionId: string, expectedProductId?: string) {
    const condition = await this.conditionOrThrow(conditionId, expectedProductId);

    // A grade that still holds STOCK cannot be deleted.
    //
    // This was checked only against the PRICE LIST, so a grade with a warehouse
    // full of material could be removed the moment its price was withdrawn —
    // leaving real, physical stock labelled with a grade that no longer exists.
    // The warehouse can see it, the system cannot name it, and no order can be
    // raised to clear it.
    //
    // Reaching zero means selling it or moving it to another grade, and the
    // transfer route exists precisely so the second is possible without
    // inventing a delivery.
    const product = await this.productRepo.findOne({
      where: { id: condition.productId },
    });
    if (product?.odooProductId) {
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

    const priced = await this.pricingRepo.count({
      where: { productId: condition.productId, conditionCode: condition.code },
    });
    if (priced > 0) {
      throw new ConflictException(
        'This condition is still priced — remove it from the price list first',
      );
    }

    // A grade that is being OFFERED cannot be deleted either.
    //
    // This was missing: stock and the price list were checked, offers were not,
    // so deleting a grade left every offer on it pointing at a code that no
    // longer existed — still listed, still inside its dates, and silently
    // unable to match anything ever again.
    //
    // The foreign key now refuses this at the database, which is the guarantee
    // that holds for code paths nobody has written yet. This check exists so
    // the admin is told WHY in a sentence they can act on, instead of a raw
    // constraint violation.
    const offered = await this.offerRepo.count({
      where: { conditionId: condition.id },
    });
    if (offered > 0) {
      throw new ConflictException(
        'This condition is used by a live offer — end or delete the offer first',
      );
    }

    await this.conditionRepo.delete(conditionId);
    if (condition.odooConditionId) {
      await this.odooSync.enqueueDeleteCondition({
        odooConditionId: condition.odooConditionId,
      });
    }
    await this.afterChange(adminId, 'DELETE_PRODUCT_CONDITION', conditionId, {
      productId: condition.productId,
      code: condition.code,
    });

    // Renumber what is left so the sequence stays 1..n with no hole.
    const rest = await this.conditionRepo.find({
      where: { productId: condition.productId },
      order: { sortOrder: 'ASC' },
    });
    rest.forEach((c, i) => (c.sortOrder = i + 1));
    if (rest.length) await this.conditionRepo.save(rest);

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
