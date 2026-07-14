import { AppDataSource } from '../data-source';
import { seedAdmin } from './admin-seed';
import { seedProvince } from './province-seed';
import { seedPermissions } from './permissions-seed';
import { seedInstitutionTypes } from './institution-type-seed';
import { seedShifts } from './shift-seed';
import { seedUnits } from './unit-seed';
import { seedConditions } from './condition-seed';
import { winstonLogger } from '@src/core/logger-config/winston.config';

async function run() {
  try {
    winstonLogger.info('Running seed process', {
      context: 'SeedRunner',
      channel: 'app',
      metadata: {
        task: 'seed',
      },
    });

    await AppDataSource.initialize();

    await seedPermissions(AppDataSource);
    await seedAdmin(AppDataSource);
    await seedProvince(AppDataSource);
    await seedInstitutionTypes(AppDataSource);
    await seedShifts(AppDataSource);
    await seedUnits(AppDataSource);
    await seedConditions(AppDataSource);

    winstonLogger.info('Seed completed successfully', {
      context: 'SeedRunner',
      channel: 'app',
      metadata: {
        task: 'seed',
      },
    });

    await AppDataSource.destroy();
  } catch (error: any) {
    winstonLogger.error('Seed failed', {
      context: 'SeedRunner',
      channel: 'app',
      stack: error?.stack,
      metadata: {
        message: error?.message,
      },
    });
    process.exit(1);
  }
}

run();