import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Province } from '@src/user/entities/location/province.entity';

/** One kind of thing still attached to a governorate. */
export interface ProvinceReference {
  entity: string;
  count: number;
}

/**
 * Everything that would be orphaned by deleting a governorate.
 *
 * A governorate is not a label — it is the key the whole ordering flow matches
 * on. Deleting one that is still in use does not merely lose a name: a
 * warehouse left without a province can never be allocated an order again, and
 * the failure is silent, because nothing errors — the warehouse simply stops
 * appearing as a candidate for the rest of its life.
 *
 * So the check is exhaustive and the answer is itemised. "Cannot delete" alone
 * leaves the admin guessing; "3 warehouses, 12 factories" tells them what to
 * move first.
 */
@Injectable()
export class ProvinceUsageService {
  /**
   * Tables holding a province_id, with the human name to report.
   *
   * Driven by a list rather than a chain of counts so a new table that
   * references provinces is one line — and, more importantly, so forgetting to
   * add it is a visible omission rather than a silent gap in the guard.
   */
  private static readonly REFERENCING_TABLES: ReadonlyArray<{
    table: string;
    label: string;
  }> = [
    { table: 'warehouses', label: 'warehouse' },
    { table: 'factory_profiles', label: 'factory' },
    { table: 'external_partner_profiles', label: 'free facility' },
    { table: 'institution_profiles', label: 'institution' },
    { table: 'collector_profiles', label: 'driver' },
    { table: 'locations', label: 'saved location' },
    { table: 'cities', label: 'city' },
    { table: 'delivery_tariffs', label: 'delivery tariff' },
    { table: 'orders', label: 'order' },
  ];

  constructor(
    @InjectRepository(Province)
    private readonly provinceRepo: Repository<Province>,
  ) {}

  /** Everything still pointing at this governorate, empty when it is free. */
  async referencesTo(provinceId: string): Promise<ProvinceReference[]> {
    const found: ProvinceReference[] = [];
    for (const { table, label } of ProvinceUsageService.REFERENCING_TABLES) {
      const rows = await this.provinceRepo.query(
        `SELECT COUNT(*)::int AS count FROM "${table}" WHERE province_id = $1`,
        [provinceId],
      );
      const count = rows?.[0]?.count ?? 0;
      if (count > 0) found.push({ entity: label, count });
    }
    return found;
  }

  /** "3 warehouses, 12 factories" — what the admin has to move first. */
  static describe(references: ProvinceReference[]): string {
    return references
      .map((r) => `${r.count} ${r.entity}${r.count === 1 ? '' : 's'}`)
      .join(', ');
  }
}
