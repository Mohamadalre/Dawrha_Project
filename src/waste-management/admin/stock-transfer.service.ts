import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../entities/product.entity';
import { MaterialCondition } from '../entities/material-condition.entity';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { AuditService } from '@src/waste-management/common/providers/audit.service';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';

/**
 * Moving stock from one GRADE to another, for the same material.
 *
 * A re-inspection changes the answer: material graded GOOD on arrival turns out
 * to be EXCELLENT, or the other way round. Without this the only options were to
 * write it off and re-receive it — which invents a delivery that never happened
 * — or to leave the stock mislabelled and mispriced.
 *
 * WHERE THE MOVE HAPPENS is the whole point. Odoo is the sole writer of stock
 * quantities and the backend only mirrors them. An earlier version moved its own
 * mirror and then asked for a warehouse re-sync — which re-read Odoo (still
 * holding the OLD grades, because nothing told it otherwise) and overwrote the
 * mirror straight back. The re-grade looked done for a second and then silently
 * reverted. So the move is made in ODOO, over the queue like every other Odoo
 * write, and the mirror follows the inventory ping Odoo fires. This service only
 * validates and records the intent.
 *
 * Three rules, and each exists because of a specific way this goes wrong:
 *
 *   1. Both grades must belong to the SAME material. A grade is unique only
 *      within its material, so "GOOD" names a different thing for paper than
 *      for copper; a transfer across materials would move quantity between two
 *      unrelated things and no total would balance afterwards.
 *
 *   2. Only UNRESERVED quantity moves. Reserved stock is already promised to an
 *      order that has not shipped, and moving it would leave that order pointing
 *      at a grade its goods are no longer in — the shortage surfacing at
 *      deduction time, after the buyer was told yes. The mirror is pre-checked
 *      here for a fast, clear error; Odoo re-checks authoritatively.
 *
 *   3. The source grade is NOT deleted when it empties. An empty grade is still
 *      a grade this material is sold at; removing it because today's stock ran
 *      out would silently change the material's price sheet and every future
 *      sorting screen. (Enforced in Odoo, which owns the rows.)
 */
@Injectable()
export class StockTransferService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(MaterialCondition)
    private readonly conditionRepo: Repository<MaterialCondition>,
    @InjectRepository(WarehouseInventory)
    private readonly inventoryRepo: Repository<WarehouseInventory>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    private readonly audit: AuditService,
    private readonly odooSync: OdooSyncService,
  ) {}

  async transfer(
    adminId: string,
    productId: string,
    input: {
      warehouseId: string;
      fromConditionId: string;
      toConditionId: string;
      quantity: number;
      reason?: string;
    },
  ) {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Material not found');
    if (!product.odooProductId) {
      throw new BadRequestException(
        'This material is not mirrored in Odoo yet, so it holds no warehouse stock to move',
      );
    }

    if (input.fromConditionId === input.toConditionId) {
      throw new BadRequestException(
        'The source and destination grades are the same — there is nothing to move',
      );
    }
    if (!(input.quantity > 0)) {
      throw new BadRequestException('The quantity to move must be above zero');
    }

    const [from, to] = await Promise.all([
      this.gradeOfProduct(input.fromConditionId, productId, 'source'),
      this.gradeOfProduct(input.toConditionId, productId, 'destination'),
    ]);

    const warehouse = await this.warehouseRepo.findOne({
      where: { id: input.warehouseId },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    if (!warehouse.odooWarehouseId) {
      throw new BadRequestException(
        'This warehouse is not mirrored in Odoo yet, so its stock cannot be moved',
      );
    }

    // Pre-check against the mirror for a fast, clear error before anything is
    // queued. Odoo re-checks authoritatively at apply time — the mirror can lag
    // it by a sync — so passing here is necessary, not sufficient.
    const source = await this.inventoryRepo.findOne({
      where: {
        warehouseId: input.warehouseId,
        odooProductId: product.odooProductId,
        conditionCode: from.code,
      },
    });
    if (!source) {
      throw new NotFoundException(
        'This warehouse holds no stock of the source grade',
      );
    }

    // Only what is NOT promised to an order may move.
    const held = Number(source.quantity);
    const reserved = Number(source.reservedQuantity);
    const movable = Math.max(held - reserved, 0);

    if (input.quantity - movable > 0.0005) {
      // The sentences are kept whole and free of numbers on purpose: the error
      // filter translates by exact match on the message, so anything
      // interpolated into it would reach an Arabic caller in English. The
      // caller already has the held/reserved figures from the stock listing.
      throw new ConflictException(
        reserved > 0
          ? 'Part of this grade is reserved for orders that have not shipped yet, and only the unreserved quantity can be moved'
          : 'This warehouse does not hold that much of the source grade',
      );
    }

    // Record the INTENT. The actual quantities move in Odoo; this is the audit
    // that an admin asked for the move, which is what a later dispute needs.
    await this.audit.record({
      userId: adminId,
      action: 'TRANSFER_STOCK_BETWEEN_GRADES',
      entityType: 'warehouse_inventory',
      entityId: productId,
      oldValues: { grade: from.code, quantity: held },
      newValues: {
        grade: to.code,
        moved: round3(input.quantity),
        warehouseId: input.warehouseId,
        reason: input.reason ?? null,
      },
    });

    // The move itself: made in Odoo (the sole writer of quantities), over the
    // queue like every other Odoo write. Odoo keeps the warehouse total
    // unchanged and fires an inventory ping, so the mirror converges to the
    // truth through SYNC_WAREHOUSE — the existing channel, so no new reconciler
    // is owed.
    await this.odooSync.enqueueTransferStockGrade({
      warehouseId: input.warehouseId,
      warehouseOdooId: warehouse.odooWarehouseId,
      odooProductId: product.odooProductId,
      fromCondition: from.code,
      toCondition: to.code,
      quantity: round3(input.quantity),
      adminId,
      reason: input.reason,
    });

    return {
      message:
        'Stock re-grade queued — it is applied in Odoo and the mirror updates on confirmation',
      product_id: productId,
      warehouse_id: input.warehouseId,
      from: { condition_id: from.id, code: from.code, movable_now: round3(movable) },
      to: { condition_id: to.id, code: to.code },
      quantity: round3(input.quantity),
      reserved_untouched: round3(reserved),
      reason: input.reason ?? null,
    };
  }

  /**
   * A grade, asserted to belong to THIS material.
   *
   * The check is the point of taking ids rather than codes: a code is unique
   * only within its material, so nothing about the string `"GOOD"` says which
   * material's GOOD it is.
   */
  private async gradeOfProduct(
    conditionId: string,
    productId: string,
    role: 'source' | 'destination',
  ): Promise<MaterialCondition> {
    const condition = await this.conditionRepo.findOne({
      where: { id: conditionId },
    });
    if (!condition) {
      // Written out per role rather than interpolated: the error filter
      // translates by exact match on the whole sentence, so a `${role}` in the
      // middle of it would strand an Arabic caller with English.
      throw new NotFoundException(
        role === 'source'
          ? 'The source grade does not exist'
          : 'The destination grade does not exist',
      );
    }
    if (condition.productId !== productId) {
      // 400, not 404: the grade exists and the admin may well be allowed to
      // use it — what is wrong is the pairing, and saying so lets them fix the
      // request instead of hunting a missing record.
      throw new BadRequestException(
        role === 'source'
          ? 'The source grade belongs to a different material — stock can only move between grades of the same material'
          : 'The destination grade belongs to a different material — stock can only move between grades of the same material',
      );
    }
    return condition;
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
