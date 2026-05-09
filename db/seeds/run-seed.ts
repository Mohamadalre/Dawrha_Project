import { AppDataSource } from '../data-source';
import { seedAdmin } from './admin-seed';
import { seedProvince } from './province-seed';
import { seedPermissions } from './permissions-seed';
import { seedInstitutionTypes } from './institution-type-seed';
import { logger } from '@src/common/logger/winston.logger';

async function run() {
  try {
    logger.info('Running Seed...');

    await AppDataSource.initialize();

    await seedPermissions(AppDataSource);
    await seedAdmin(AppDataSource);
    await seedProvince(AppDataSource);
    await seedInstitutionTypes(AppDataSource);
    logger.info('Seed Completed Successfully');

    await AppDataSource.destroy();
  } catch (error:any) {
    logger.error(`Seed Failed: ${error.message}`);
    process.exit(1);
  }
}

run();