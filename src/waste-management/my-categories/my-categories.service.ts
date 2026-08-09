import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { AssignedCategoryProvider } from '@src/waste-management/common/providers/assigned-category.provider';
import { AssignedCategoryWriter } from './assigned-category.writer';

interface Caller {
  id: string;
  role: Role;
}

/** Roles that have a material step, and therefore a "my categories" list. */
const CATEGORY_ROLES = [Role.INSTITUTIONS, Role.FACTORY, Role.EXTERNAL_PARTNER];

/**
 * A buyer's OWN selected categories — the ones they picked at onboarding, now a
 * personal list they can grow themselves.
 *
 * These no longer restrict what the buyer sees (the whole active catalogue is
 * visible to everyone); they are just the buyer's shortlist, shown on its own
 * route and extendable from here without any admin approval.
 */
@Injectable()
export class MyCategoriesService {
  constructor(
    @InjectRepository(WasteCategory)
    private readonly categoryRepo: Repository<WasteCategory>,
    private readonly assignedCategories: AssignedCategoryProvider,
    private readonly writer: AssignedCategoryWriter,
  ) {}

  /**
   * Add categories to the caller's own list. Validates that each id exists AND
   * is active, de-duplicates, and silently skips any already on the list (so a
   * repeat add never creates a duplicate pivot row). Returns the resulting list.
   */
  async addCategories(caller: Caller, categoryIds: string[]) {
    if (!CATEGORY_ROLES.includes(caller.role)) {
      throw new ForbiddenException('This role cannot hold assigned categories');
    }

    const uniqueIds = [...new Set(categoryIds)];
    const categories = await this.categoryRepo.find({
      where: { id: In(uniqueIds), isActive: true },
    });
    if (categories.length !== uniqueIds.length) {
      const found = new Set(categories.map((c) => c.id));
      const invalid = uniqueIds.filter((id) => !found.has(id));
      throw new BadRequestException({
        message: 'Some of these waste categories do not exist or are no longer available',
        errorCode: 'WASTE_CATEGORY_NOT_FOUND',
        invalid_ids: invalid,
      });
    }

    const current = (await this.assignedCategories.getSelectedCategoryIds(caller.id, caller.role)) ?? [];
    const currentSet = new Set(current);
    const toAdd = uniqueIds.filter((id) => !currentSet.has(id));
    if (toAdd.length > 0) {
      await this.writer.addCategories(caller.id, caller.role, toAdd);
    }

    return { ...(await this.list(caller)), added: toAdd.length };
  }

  /** The caller's current selected-categories list (id + name), sorted. */
  async list(caller: Caller) {
    if (!CATEGORY_ROLES.includes(caller.role)) {
      throw new ForbiddenException('This role cannot hold assigned categories');
    }
    const ids = (await this.assignedCategories.getSelectedCategoryIds(caller.id, caller.role)) ?? [];
    if (ids.length === 0) return { categories: [] };
    const rows = await this.categoryRepo.find({
      where: { id: In(ids) },
      order: { name: 'ASC' },
    });
    return { categories: rows.map((c) => ({ id: c.id, name: c.name })) };
  }
}
