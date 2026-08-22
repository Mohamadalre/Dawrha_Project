import { BadRequestException } from '@nestjs/common';
import { Like, Repository } from 'typeorm';

/**
 * Sequential business numbers ('CR-2026-08-00001', 'RTE-2026-08-17-001', ...).
 *
 * Count-of-prefix + 1 stays collision-free as long as rows are never deleted,
 * which holds for both numbers in this domain (a cancelled request keeps its
 * number). The DB unique constraint is the backstop for races; three retries
 * absorb them.
 */
export async function nextSequentialNumber(
  repo: Repository<{ id: string }>,
  field: string,
  prefix: string,
  padding: number,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const count = await repo.count({
      where: { [field]: Like(`${prefix}-%`) },
    });
    const candidate = `${prefix}-${String(count + 1).padStart(padding, '0')}`;
    const exists = await repo.findOne({ where: { [field]: candidate } });
    if (!exists) return candidate;
  }
  throw new BadRequestException('Could not allocate a number - try again');
}
