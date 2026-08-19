import { AppDataSource } from '../data-source';
import { seedAdmin } from './admin-seed';
import { seedProvince } from './province-seed';
import { seedPermissions } from './permissions-seed';
import { seedInstitutionTypes } from './institution-type-seed';
import { seedUnits } from './unit-seed';
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
    // NOTE: shifts are intentionally NOT seeded. Odoo is the single source of
    // truth for shifts; they reach the backend only via the fleet mirror
    // (SYNC_FLEET). Any locally-seeded shift would be a phantom the driver
    // pickers must never show.
    await seedUnits(AppDataSource);
    // NOTE: material conditions (grades) are intentionally NOT seeded. They are
    // per-product, not a global list (see material-condition.entity.ts): a
    // material starts ungraded and the admin adds the grades it actually has via
    // POST /api/v1/admin/waste/conditions. A global seed both contradicts that
    // design and violates the NOT-NULL product_id column, so it is removed.

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