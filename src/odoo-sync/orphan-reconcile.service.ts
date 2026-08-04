import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, IsNull, Repository } from 'typeorm';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { MeasurementUnit } from '@src/waste-management/entities/measurement-unit.entity';
import { MaterialCondition } from '@src/waste-management/entities/material-condition.entity';
import { OdooService } from '@src/odoo/odoo.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'ORPHAN_RECONCILE', channel: 'jobs' } as const;

export interface OrphanReport {
  categories: number[];
  products: number[];
  units: number[];
  conditions: number[];
  total: number;
}

/**
 * Finds catalogue rows that exist in ODOO and correspond to nothing here.
 *
 * This is the last direction of the split brain and the only one no other
 * safety net can see. Deleting a category, product, unit or condition enqueues
 * the delete and then removes the local row immediately — so if that job
 * exhausts its retries, the record survives in Odoo with nothing left on this
 * side to detect it by. Every other reconciler in this module keys off a
 * surviving local row; here there is none, so the only way to see it is to
 * compare the whole set.
 *
 * WHY IT REPORTS INSTEAD OF DELETING
 *
 * Deleting from a set comparison is irreversible and its blast radius is the
 * entire catalogue: one bad read, one id column left null by an unrelated bug,
 * and this would remove products Odoo's stock rows and invoices depend on. The
 * safe half of the job — making the orphan impossible to miss — is the half
 * that was actually absent. Removing it is an admin's deliberate act, and the
 * log line names the exact ids to remove.
 *
 * That is the same call made for a driver whose backend status is ahead of
 * Odoo: converge automatically only where the change is additive or recoverable,
 * and report where it destroys data.
 */
@Injectable()
export class OrphanReconcileService {
  constructor(
    @InjectRepository(WasteCategory)
    private readonly categoryRepo: Repository<WasteCategory>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(MeasurementUnit)
    private readonly unitRepo: Repository<MeasurementUnit>,
    @InjectRepository(MaterialCondition)
    private readonly conditionRepo: Repository<MaterialCondition>,
    private readonly odoo: OdooService,
  ) {}

  /**
   * Hourly, not every ten minutes: this reads four whole tables from Odoo, and
   * a deletion that failed is not getting worse while it waits.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduledReconcile(): Promise<void> {
    await this.findOrphans('cron');
  }

  async findOrphans(trigger: 'cron' | 'manual'): Promise<OrphanReport> {
    const empty: OrphanReport = {
      categories: [], products: [], units: [], conditions: [], total: 0,
    };
    try {
      const odooIds = await this.odoo.fetchCatalogueIds();

      const known = async (repo: Repository<any>, column: string): Promise<Set<number>> => {
        const rows = await repo.find({
          where: { [column]: Not(IsNull()) },
          select: [column],
        });
        return new Set(rows.map((r) => r[column] as number));
      };

      const report: OrphanReport = {
        categories: this.diff(odooIds.categories, await known(this.categoryRepo, 'odooCategoryId')),
        products: this.diff(odooIds.products, await known(this.productRepo, 'odooProductId')),
        units: this.diff(odooIds.units, await known(this.unitRepo, 'odooUnitId')),
        conditions: this.diff(odooIds.conditions, await known(this.conditionRepo, 'odooConditionId')),
        total: 0,
      };
      report.total =
        report.categories.length + report.products.length +
        report.units.length + report.conditions.length;

      if (report.total) {
        winstonLogger.warn(
          `${report.total} catalogue row(s) exist in Odoo with no counterpart here — ` +
            `a delete that never landed. Remove them in Odoo: ` +
            Object.entries(report)
              .filter(([k, v]) => k !== 'total' && (v as number[]).length)
              .map(([k, v]) => `${k}=[${(v as number[]).join(',')}]`)
              .join(' '),
          LOG_META,
        );
      }
      return report;
    } catch (err) {
      winstonLogger.warn(
        `Orphan reconcile skipped (${trigger}): ${(err as Error).message}`,
        LOG_META,
      );
      return empty;
    }
  }

  private diff(odooIds: number[], known: Set<number>): number[] {
    return odooIds.filter((id) => !known.has(id));
  }
}
