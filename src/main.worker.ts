/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { NestFactory } from '@nestjs/core';
import * as dotenv from 'dotenv';
import { WinstonModule } from 'nest-winston';
import { AppModule } from './app.module';
import { winstonConfig, winstonLogger } from './core/logger-config/winston.config';

/**
 * Dedicated maintenance worker.
 *
 * This is a SEPARATE process from the API (`main.ts`). It boots the application
 * as a headless context (no HTTP server, no routes) purely to run the scheduled
 * cleanup jobs in {@link MaintenanceService}. The destructive deletes therefore
 * run in this single isolated process and never on the request-serving API
 * instances.
 *
 * The maintenance crons are gated by MAINTENANCE_WORKER — we force it on here so
 * the jobs fire only when started through this entrypoint.
 *
 * Run:
 *   - dev:  npm run start:worker:dev
 *   - prod: npm run start:worker   (node dist/src/main.worker)
 */
async function bootstrapWorker() {
  dotenv.config();
  // Enable the maintenance crons for this process only.
  process.env.MAINTENANCE_WORKER = 'true';

  const logger = WinstonModule.createLogger(winstonConfig);
  try {
    // Headless application context: providers are instantiated and the cron
    // scheduler starts, but no HTTP port is opened.
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger,
      bufferLogs: true,
    });
    app.enableShutdownHooks();
    winstonLogger.info('Maintenance worker started — scheduled cleanup jobs are active', {
      context: 'WORKER',
      channel: 'jobs',
    });
  } catch (error: any) {
    winstonLogger.error(`Maintenance worker failed to start: ${error.message}`, {
      context: 'WORKER',
      channel: 'jobs',
      stack: error.stack,
    });
    process.exit(1);
  }
}

bootstrapWorker();

process.on('uncaughtException', (err: Error) => {
  winstonLogger.error(`Uncaught Exception (worker): ${err.message}`, {
    context: 'WORKER',
    stack: err.stack,
    channel: 'exceptions',
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  winstonLogger.error(`Unhandled Rejection (worker) at: ${promise}, reason: ${reason}`, {
    context: 'WORKER',
    channel: 'exceptions',
    metadata: { reason },
  });
});
