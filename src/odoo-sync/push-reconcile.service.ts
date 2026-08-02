import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { ShiftChangeRequest } from '@src/truck/entities/shift-change-request.entity';
import { TruckProblem } from '@src/truck/entities/truck-problem.entity';
import { TruckHandover } from '@src/truck/entities/truck-handover.entity';
import { OdooSyncService } from './odoo-sync.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'PUSH_RECONCILE', channel: 'jobs' } as const;

/**
 * Wait this long before treating a row as "lost". A push job that is still
 * queued or retrying would otherwise be duplicated by the cron; 5 minutes is
 * comfortably past the retry windows (3 attempts × 5s backoff).
 */
const GRACE_MS = 5 * 60 * 1000;

/** Don't hammer Odoo if a long outage left a big backlog. */
const BATCH = 50;

/**
 * Safety net for every backend → Odoo push that MIRRORS a backend row.
 *
 * Each of these records is created in the backend first and then pushed to Odoo
 * by a queued job that stores the returned Odoo id back on the row. That gives
 * a precise, cheap drift signal: **`odoo*Id IS NULL` after the grace period
 * means the push never landed** — the row exists here and nowhere in Odoo, so
 * the warehouse manager never sees the driver's shift-change request, truck
 * problem or attendance record.
 *
 * Before this cron those pushes were fire-once (3 attempts over ~15s): an Odoo
 * restart or a network blip lost them permanently, exactly like the driver
 * requests did. Re-pushing is safe because each Odoo model now UPSERTS on the
 * backend key (`backend_request_id` / `backend_problem_id` /
 * `backend_handover_id`), so a recovery converges to exactly one row and never
 * duplicates — and the truck-problem model only notifies the manager for
 * genuinely new rows.
 */
@Injectable()
export class PushReconcileService implements OnModuleInit {
  constructor(
    @InjectRepository(ShiftChangeRequest)
    private readonly shiftChangeRepo: Repository<ShiftChangeRequest>,
    @InjectRepository(TruckProblem)
    private readonly truckProblemRepo: Repository<TruckProblem>,
    @InjectRepository(TruckHandover)
    private readonly handoverRepo: Repository<TruckHandover>,
    private readonly odooSync: OdooSyncService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcile('startup');
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduledReconcile(): Promise<void> {
    await this.reconcile('cron');
  }

  private async reconcile(trigger: 'startup' | 'cron'): Promise<void> {
    const cutoff = new Date(Date.now() - GRACE_MS);
    try {
      const counts = {
        shiftChanges: await this.repushShiftChanges(cutoff),
        truckProblems: await this.repushTruckProblems(cutoff),
        handovers: await this.repushHandovers(cutoff),
      };
      const total = counts.shiftChanges + counts.truckProblems + counts.handovers;
      if (total) {
        winstonLogger.info(
          `Re-pushed ${total} record(s) missing in Odoo (${trigger}) — ` +
            `shift-changes: ${counts.shiftChanges}, truck-problems: ${counts.truckProblems}, ` +
            `handovers: ${counts.handovers}`,
          LOG_META,
        );
      }
    } catch (err) {
      // Never let a bad tick kill the loop — the next one retries.
      winstonLogger.warn(
        `Push reconciliation error (${trigger}): ${(err as Error).message}`,
        LOG_META,
      );
    }
  }

  private async repushShiftChanges(cutoff: Date): Promise<number> {
    const rows = await this.shiftChangeRepo.find({
      where: { odooRequestId: IsNull(), createdAt: LessThan(cutoff) },
      take: BATCH,
    });
    for (const r of rows) {
      await this.odooSync.enqueuePushShiftChange({ requestId: r.id });
    }
    return rows.length;
  }

  private async repushTruckProblems(cutoff: Date): Promise<number> {
    const rows = await this.truckProblemRepo.find({
      where: { odooProblemId: IsNull(), createdAt: LessThan(cutoff) },
      take: BATCH,
    });
    for (const r of rows) {
      await this.odooSync.enqueuePushTruckProblem({ problemId: r.id });
    }
    return rows.length;
  }

  /**
   * A handover row is pushed on PICKUP and closed on DROPOFF. Missing Odoo id
   * → the pickup never landed, so re-push the pickup; the dropoff push is a
   * separate idempotent close keyed on the same backend id.
   */
  private async repushHandovers(cutoff: Date): Promise<number> {
    const rows = await this.handoverRepo.find({
      where: { odooHandoverId: IsNull(), createdAt: LessThan(cutoff) },
      take: BATCH,
    });
    let pushed = 0;
    for (const r of rows) {
      if (!r.pickedUpAt) continue; // nothing happened yet — nothing to mirror
      await this.odooSync.enqueuePushHandoverPickup({ handoverId: r.id });
      if (r.droppedOffAt) {
        await this.odooSync.enqueuePushHandoverDropoff({ handoverId: r.id });
      }
      pushed++;
    }
    return pushed;
  }
}
