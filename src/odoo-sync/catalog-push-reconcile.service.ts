import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Not, Repository } from 'typeorm';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { MeasurementUnit } from '@src/waste-management/entities/measurement-unit.entity';
import { MaterialCondition } from '@src/waste-management/entities/material-condition.entity';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { OdooSyncStatus } from '@src/waste-management/enums/odoo-sync-status.enum';
import { OdooSyncService } from './odoo-sync.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'CATALOG_PUSH_RECONCILE', channel: 'jobs' } as const;

/**
 * Past every retry window (3 attempts × 5s) by a wide margin, so a job still
 * working is never duplicated.
 */
const GRACE_MS = 5 * 60 * 1000;

/** Don't hammer Odoo if a long outage left a big backlog. */
const BATCH = 50;

/**
 * Re-pushes catalogue rows that never reached Odoo.
 *
 * Every one of these tables carries an `odooSyncStatus` column: PENDING when
 * the row is created, SYNCED when the push lands, FAILED when the job gives up.
 * The column was WRITTEN in five places and READ in none — nothing, anywhere in
 * the codebase, ever asked which rows had failed.
 *
 * So the plainest version of the split brain had no safety net at all: an admin
 * creates a category, product, unit, condition or warehouse while Odoo happens
 * to be down, the job exhausts its three attempts, the row is stamped FAILED —
 * and that is where it stays for ever. The record exists here and nowhere in
 * Odoo. Nobody is told; the admin's screen shows the thing they just created.
 *
 * The catalogue is exactly the data both systems must agree on: Odoo's sorting
 * screens write stock against these products, in these units, at these
 * conditions, and its invoices price them from the pricing rows pushed
 * alongside. A product missing there is stock that cannot be recorded.
 *
 * Re-pushing is safe because every handler upserts by the stored Odoo id (or
 * creates when there is none), so a row that actually did land is refreshed
 * rather than duplicated.
 *
 * PRICING travels with its product: `UPDATE_PRICING` is keyed on productId and
 * replaces the whole condition-price matrix, so re-pushing a product's prices
 * is idempotent and repairs a half-applied price change too.
 */
@Injectable()
export class CatalogPushReconcileService implements OnModuleInit {
  constructor(
    @InjectRepository(WasteCategory)
    private readonly categoryRepo: Repository<WasteCategory>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(MeasurementUnit)
    private readonly unitRepo: Repository<MeasurementUnit>,
    @InjectRepository(MaterialCondition)
    private readonly conditionRepo: Repository<MaterialCondition>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    private readonly odooSync: OdooSyncService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcile('startup');
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduledReconcile(): Promise<void> {
    await this.reconcile('cron');
  }

  async reconcile(
    trigger: 'startup' | 'cron' | 'manual',
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {
      categories: 0,
      products: 0,
      units: 0,
      conditions: 0,
      warehouses: 0,
    };
    const cutoff = new Date(Date.now() - GRACE_MS);
    try {
      // A row is unsynced when the push never confirmed. Both halves matter:
      // FAILED is the job giving up, and a PENDING row older than the grace
      // period is a job that vanished (a worker killed mid-flight, a queue
      // flushed) and will therefore never report anything at all.
      const unsynced = { odooSyncStatus: Not(OdooSyncStatus.SYNCED), createdAt: LessThan(cutoff) };

      for (const row of await this.categoryRepo.find({ where: unsynced, take: BATCH })) {
        await this.odooSync.enqueueSyncCategory({ categoryId: row.id });
        counts.categories++;
      }
      for (const row of await this.productRepo.find({ where: unsynced, take: BATCH })) {
        await this.odooSync.enqueueSyncProduct({ productId: row.id });
        // The product's prices are pushed by their own job and are just as
        // lost as the product was — Odoo's invoices read them.
        await this.odooSync.enqueueUpdatePricing({ productId: row.id });
        counts.products++;
      }
      for (const row of await this.unitRepo.find({ where: unsynced, take: BATCH })) {
        await this.odooSync.enqueueSyncUnit({ unitId: row.id });
        counts.units++;
      }
      for (const row of await this.conditionRepo.find({ where: unsynced, take: BATCH })) {
        await this.odooSync.enqueueSyncCondition({ conditionId: row.id });
        counts.conditions++;
      }
      for (const row of await this.warehouseRepo.find({ where: unsynced, take: BATCH })) {
        // CREATE vs UPDATE is not interchangeable here. `createWarehouse`
        // short-circuits to SYNCED the moment the row already carries an Odoo
        // id — so sending a warehouse whose EDIT was lost through the create
        // job would stamp it synced and push nothing, clearing the only signal
        // that anything was wrong while Odoo kept the old name.
        if (row.odooWarehouseId) {
          await this.odooSync.enqueueUpdateWarehouse({ warehouseId: row.id });
        } else {
          await this.odooSync.enqueueCreateWarehouse({ warehouseId: row.id });
        }
        counts.warehouses++;
      }

      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      if (total) {
        winstonLogger.warn(
          `Re-pushed ${total} catalogue row(s) that never reached Odoo (${trigger}) — ` +
            Object.entries(counts)
              .filter(([, n]) => n)
              .map(([k, n]) => `${k}: ${n}`)
              .join(', '),
          LOG_META,
        );
      }
    } catch (err) {
      // Runs on a timer — a bad tick must never kill the loop.
      winstonLogger.warn(
        `Catalogue push reconcile error (${trigger}): ${(err as Error).message}`,
        LOG_META,
      );
    }
    return counts;
  }
}
