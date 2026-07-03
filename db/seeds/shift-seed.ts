import { DataSource } from 'typeorm';
import { Shift } from '@src/shift/entities/shift.entity';

/**
 * Seeds the two work shifts (Morning / Evening). Idempotent: existing shifts
 * (matched by name) are left untouched, so admins keep their edited times.
 */
const DEFAULT_SHIFTS = [
  { name: 'Morning', startTime: '06:00:00', endTime: '14:00:00' },
  { name: 'Evening', startTime: '14:00:00', endTime: '22:00:00' },
];

export async function seedShifts(dataSource: DataSource): Promise<void> {
  const shiftRepo = dataSource.getRepository(Shift);

  for (const shift of DEFAULT_SHIFTS) {
    const exists = await shiftRepo.findOne({ where: { name: shift.name } });
    if (!exists) {
      await shiftRepo.save(shiftRepo.create(shift));
    }
  }

  console.log('Shifts seeded (Morning / Evening)');
}
