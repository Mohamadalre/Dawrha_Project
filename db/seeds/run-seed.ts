import { AppDataSource } from '../data-source';
import { seedAdmin } from './admin-seed';
import { seed } from './seed';
import { logger } from '@src/common/logger/winston.logger';

async function run() {
  try {
    logger.info('Running Seed...');

    await AppDataSource.initialize();

    await seed(AppDataSource);
    await seedAdmin(AppDataSource);

    logger.info('Seed Completed Successfully');

    await AppDataSource.destroy();
  } catch (error) {
    logger.error(`Seed Failed: ${error.message}`);
    process.exit(1);
  }
}

run();