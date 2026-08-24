import { BadRequestException } from '@nestjs/common';
import { Like, Repository } from 'typeorm';

/**
 * Sequential business numbers ('CR-2026-08-00001', 'RTE-2026-08-17-001', ...).
 *
 * The next number is MAX(existing numeric suffix) + 1, so deleted rows leave
 * harmless gaps instead of wedging allocation the way count-of-prefix did.
 * The DB unique constraint is the backstop for races; retries absorb them.
 */
export async function nextSequentialNumber(
  repo: Repository<{ id: string }>,
  field: string,
  prefix: string,
  padding: number,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await repo.find({
      where: { [field]: Like(`${prefix}-%`) },
      select: [field] as any,
    });
    let maxSeq = 0;
    for (const row of rows) {
      const suffix = Number(String(row[field]).split('-').pop());
      if (Number.isFinite(suffix) && suffix > maxSeq) maxSeq = suffix;
    }
    const candidate = `${prefix}-${String(maxSeq + 1).padStart(padding, '0')}`;
    const exists = await repo.findOne({ where: { [field]: candidate } });
    if (!exists) return candidate;
  }
  throw new BadRequestException('Could not allocate a number - try again');
}
