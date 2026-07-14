import { DataSource } from 'typeorm';
import { MeasurementUnit } from '@src/waste-management/entities/measurement-unit.entity';

/**
 * Seeds the two built-in measurement units (KG / PIECE). Idempotent: existing
 * codes are left untouched, so admin edits (names, activation) survive re-runs.
 * Admins add further units at runtime via POST /api/v1/admin/waste/units.
 */
const DEFAULT_UNITS = [
  // Weight: sorter's quantity may differ from the shipment (allowsTolerance).
  { code: 'KG', nameEn: 'Kilogram', nameAr: 'كغم', isWeight: true, allowsTolerance: true },
  // Count: sorted quantity must match the shipment exactly.
  { code: 'PIECE', nameEn: 'Piece', nameAr: 'قطعة', isWeight: false, allowsTolerance: false },
];

export async function seedUnits(dataSource: DataSource): Promise<void> {
  const unitRepo = dataSource.getRepository(MeasurementUnit);

  for (const unit of DEFAULT_UNITS) {
    const exists = await unitRepo.findOne({ where: { code: unit.code } });
    if (!exists) {
      await unitRepo.save(unitRepo.create(unit));
    }
  }

  console.log('Measurement units seeded (KG / PIECE)');
}
