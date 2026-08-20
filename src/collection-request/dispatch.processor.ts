import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import {
  COLLECTION_DISPATCH_QUEUE,
  DISPATCH_JOB,
} from './constants/dispatch.constants';
import { DispatchEngineService } from './services/dispatch-engine.service';

const LOG_META = { context: 'DISPATCH_PROCESSOR', channel: 'collection' } as const;

/**
 * Runs the dispatch engine's jobs durably. Every trigger enqueues onto this
 * queue rather than calling the engine inline, so a restart mid-election never
 * loses the work that was about to happen.
 */
@Processor(COLLECTION_DISPATCH_QUEUE)
export class DispatchProcessor extends WorkerHost {
  constructor(private readonly engine: DispatchEngineService) {
    super();
  }

  async process(job: Job): Promise<void> {
    try {
      switch (job.name) {
        case DISPATCH_JOB.ELECT:
          await this.engine.elect(job.data?.requestId as string);
          break;
        case DISPATCH_JOB.OPEN_WINDOW:
          await this.engine.openWindow(job.data?.requestId as string);
          break;
        case DISPATCH_JOB.ELECT_NEXT_FOR_DRIVER:
          await this.engine.electNextForDriver();
          break;
        default:
          winstonLogger.warn(`Unknown dispatch job name: ${job.name}`, LOG_META);
      }
    } catch (error) {
      // A failing election must not poison the queue — the state it guards
      // (a pending offer, a NEEDS_ADMIN flag) is what the sweeper re-drives.
      winstonLogger.error(
        `Dispatch job ${job.name} failed: ${(error as Error).message}`,
        LOG_META,
      );
    }
  }
}