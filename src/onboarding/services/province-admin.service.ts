import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Province } from '@src/user/entities/location/province.entity';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { ProvinceUsageService } from './province-usage.service';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';

/** Postgres foreign-key violation — a province still referenced by a profile. */
const PG_FK_VIOLATION = '23503';

/**
 * Admin CRUD over the governorates list (the same rows `province-seed.ts`
 * bootstraps). Every profile in the system points at one of these, and the
 * driver-request push resolves the NAME from here before sending it to Odoo —
 * so renames propagate everywhere automatically and a delete must never orphan
 * a profile.
 *
 * Odoo mirrors this table as `recycle.province` and its warehouses LINK to it,
 * so every write here is pushed across. The push is enqueued AFTER the row is
 * committed and is never awaited inline: the admin's request must not fail
 * because Odoo is briefly unreachable, and the hourly reconcile re-pushes the
 * whole list anyway if a job is lost.
 */
@Injectable()
export class ProvinceAdminService {
  constructor(
    @InjectRepository(Province)
    private readonly provinceRepo: Repository<Province>,
    private readonly odooSync: OdooSyncService,
    private readonly usage: ProvinceUsageService,
  ) {}

  private toResponse(p: Province) {
    return { id: p.id, name_en: p.name_en, name_ar: p.name_ar };
  }

  /**
   * Both names are unique in the DB. Checking first turns a raw 500 constraint
   * error into a clear 409 (the unique index still guards a race).
   */
  private async assertNamesFree(
    name_en: string | undefined,
    name_ar: string | undefined,
    exceptId?: string,
  ): Promise<void> {
    const idFilter = exceptId ? { id: Not(exceptId) } : {};
    if (name_en) {
      const clash = await this.provinceRepo.findOne({ where: { ...idFilter, name_en } });
      if (clash) throw new ConflictException('A governorate with this English name already exists');
    }
    if (name_ar) {
      const clash = await this.provinceRepo.findOne({ where: { ...idFilter, name_ar } });
      if (clash) throw new ConflictException('A governorate with this Arabic name already exists');
    }
  }

  private async getOrThrow(id: string): Promise<Province> {
    const province = await this.provinceRepo.findOne({ where: { id } });
    if (!province) throw new NotFoundException('Governorate not found');
    return province;
  }

  /**
   * The governorates, a page at a time.
   *
   * The signup form's public list returns every row unpaged, which is right
   * there — a dropdown that arrives half-filled is a dropdown that cannot be
   * used. This is the ADMIN list, which is a different question: it is browsed
   * and searched rather than picked from, so it pages like every other admin
   * table and returns the Odoo mirror status the public one has no use for.
   */
  async list(query: { page?: number; limit?: number; search?: string } = {}) {
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);

    const qb = this.provinceRepo
      .createQueryBuilder('p')
      .orderBy('p.name_en', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    if (query.search) {
      // Both languages in one term: an admin types what they see on screen,
      // and which language that is depends on how they have the app set.
      qb.andWhere('(p.name_en ILIKE :s OR p.name_ar ILIKE :s)', {
        s: `%${query.search}%`,
      });
    }

    const [rows, total] = await qb.getManyAndCount();
    return {
      provinces: rows.map((p) => ({
        id: p.id,
        name_en: p.name_en,
        name_ar: p.name_ar,
      })),
      pagination: buildPagination(total, page, limit),
    };
  }

  async create(dto: { name_en: string; name_ar: string }) {
    await this.assertNamesFree(dto.name_en, dto.name_ar);
    const saved = await this.provinceRepo.save(this.provinceRepo.create(dto));
    await this.pushToOdoo(saved.id);
    return { province: this.toResponse(saved) };
  }

  async update(id: string, dto: { name_en?: string; name_ar?: string }) {
    const province = await this.getOrThrow(id);
    await this.assertNamesFree(dto.name_en, dto.name_ar, id);
    if (dto.name_en !== undefined) province.name_en = dto.name_en;
    if (dto.name_ar !== undefined) province.name_ar = dto.name_ar;
    const saved = await this.provinceRepo.save(province);
    await this.pushToOdoo(saved.id);
    return { province: this.toResponse(saved) };
  }

  /**
   * Deletes a governorate — only when NOTHING still points at it.
   *
   * Relying on the database to refuse was not enough, and the gap was real:
   * `warehouses.province_id` was ON DELETE SET NULL and `delivery_tariffs` was
   * CASCADE, so deleting a governorate silently orphaned its warehouses and
   * deleted its delivery pricing. Nothing errored — those warehouses simply
   * stopped being candidates for any order, for good, with no trace of why.
   *
   * So the check is explicit and exhaustive, and the refusal names what is in
   * the way. A governorate with history should be left alone, not deleted.
   */
  async remove(id: string) {
    await this.getOrThrow(id);

    const references = await this.usage.referencesTo(id);
    if (references.length) {
      throw new ConflictException(
        `This governorate is still used by ${ProvinceUsageService.describe(references)} and cannot be deleted`,
      );
    }

    try {
      await this.provinceRepo.delete(id);
    } catch (err: any) {
      // Belt and braces: a row created between the check and the delete still
      // trips the database constraint, and that must read as a conflict too.
      if (err?.code === PG_FK_VIOLATION || err?.driverError?.code === PG_FK_VIOLATION) {
        throw new ConflictException(
          'This governorate is still used by existing records and cannot be deleted',
        );
      }
      throw err;
    }

    // Odoo ARCHIVES its copy rather than deleting it: warehouses created while
    // this governorate existed still point at it, and that history must survive.
    try {
      await this.odooSync.enqueueDeleteProvince({ backendProvinceId: id });
    } catch {
      // The hourly full re-push archives it anyway.
    }
    return { deleted: true, id };
  }
  /** Fire-and-forget mirror push; the reconcile cron is the safety net. */
  private async pushToOdoo(provinceId: string): Promise<void> {
    try {
      await this.odooSync.enqueueSyncProvince({ provinceId });
    } catch {
      // Queue hiccup — the hourly full re-push covers it.
    }
  }
}
