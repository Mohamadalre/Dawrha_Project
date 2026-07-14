import { DataSource } from 'typeorm';
import { MaterialCondition } from '@src/waste-management/entities/material-condition.entity';

/**
 * Seeds the four default material conditions (grades). Idempotent: existing
 * codes are left untouched, so admin edits survive re-runs. Admins add further
 * conditions at runtime via POST /api/v1/admin/waste/conditions.
 */
const DEFAULT_CONDITIONS = [
  { code: 'EXCELLENT', nameEn: 'Excellent', nameAr: 'ممتازة', sortOrder: 1 },
  { code: 'GOOD', nameEn: 'Good', nameAr: 'جيدة', sortOrder: 2 },
  { code: 'POOR', nameEn: 'Poor', nameAr: 'رديئة', sortOrder: 3 },
  { code: 'DAMAGED', nameEn: 'Damaged', nameAr: 'تالفة', sortOrder: 4 },
];

export async function seedConditions(dataSource: DataSource): Promise<void> {
  const repo = dataSource.getRepository(MaterialCondition);

  for (const condition of DEFAULT_CONDITIONS) {
    const exists = await repo.findOne({ where: { code: condition.code } });
    if (!exists) {
      await repo.save(repo.create(condition));
    }
  }

  console.log('Material conditions seeded (EXCELLENT / GOOD / POOR / DAMAGED)');
}
