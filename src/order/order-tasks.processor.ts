import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { DeliveryTripService } from './providers/delivery-trip.service';
import { ORDER_TASKS, ORDER_TASKS_QUEUE } from './order-tasks.constants';

const LOG_META = { context: 'ORDER_TASKS', channel: 'orders' } as const;

/**
 * Runs order work that was discovered elsewhere (an Odoo part event) but belongs
 * to the order module's own services.
 *
 * Today that is one job: starting a consolidation the moment its last warehouse
 * finishes preparing. The buyer chose to consolidate earlier; the trip could not
 * run until every part was ready, and this is where "now they are" turns into a
 * gathering run — without the Odoo-sync module ever depending on this one.
 */
@Processor(ORDER_TASKS_QUEUE)
export class OrderTasksProcessor extends WorkerHost {
  constructor(private readonly trips: DeliveryTripService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const orderId = job.data?.orderId as string | undefined;
    if (!orderId) return;

    // A race — the buyer cancelled, a part was rejected and re-allocated, or a
    // trip already exists — is not a failure to retry into a loop; log and let
    // the next trigger (or the buyer's own action) settle it.
    if (job.name === ORDER_TASKS.PLAN_CONSOLIDATION) {
      try {
        const result = await this.trips.planConsolidationForOrder(orderId);
        winstonLogger.info(
          `Order ${orderId}: consolidation started automatically (${(result as any).trip_count ?? 0} trip(s))`,
          LOG_META,
        );
      } catch (err) {
        winstonLogger.warn(
          `Order ${orderId}: automatic consolidation did not start — ${(err as Error).message}`,
          LOG_META,
        );
      }
      return;
    }

    if (job.name === ORDER_TASKS.PLAN_DELIVERY) {
      try {
        const result = await this.trips.planForOrder(orderId);
        winstonLogger.info(
          `Order ${orderId}: delivery planned automatically (${(result as any).trip_count ?? (result as any).trips?.length ?? 0} trip(s)) and pushed to Odoo`,
          LOG_META,
        );
      } catch (err) {
        winstonLogger.warn(
          `Order ${orderId}: automatic delivery planning did not start — ${(err as Error).message}`,
          LOG_META,
        );
      }
      return;
    }
  }
}
