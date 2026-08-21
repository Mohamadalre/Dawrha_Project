import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MyCategoriesService } from './my-categories.service';
import { Role } from '@src/user/enums/role.enum';

/**
 * A buyer's OWN selected-categories list: who may hold one, id validation,
 * de-duplication against what is already selected, and the shaped output.
 */
describe('MyCategoriesService', () => {
  const make = (over: {
    categories?: any[];
    selected?: string[];
  } = {}) => {
    const categoryRepo = {
      find: jest.fn().mockResolvedValue(over.categories ?? []),
    };
    const assignedCategories = {
      getSelectedCategoryIds: jest.fn().mockResolvedValue(over.selected ?? []),
    };
    const writer = { addCategories: jest.fn().mockResolvedValue(undefined) };
    const svc = new MyCategoriesService(
      categoryRepo as any,
      assignedCategories as any,
      writer as any,
    );
    return { svc, categoryRepo, assignedCategories, writer };
  };

  const FACTORY = { id: 'acc1', role: Role.FACTORY };

  describe('addCategories', () => {
    it('refuses a role that holds no category list (e.g. citizen)', async () => {
      const { svc, categoryRepo } = make();
      await expect(
        svc.addCategories({ id: 'c1', role: Role.CITIZEN }, ['x']),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(categoryRepo.find).not.toHaveBeenCalled();
    });

    it('rejects ids that do not exist / are inactive, naming them', async () => {
      // Asked for two ids; only one comes back active.
      const { svc } = make({ categories: [{ id: 'a', name: 'Paper' }] });
      await expect(svc.addCategories(FACTORY, ['a', 'b'])).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: 'WASTE_CATEGORY_NOT_FOUND',
          invalid_ids: ['b'],
        }),
      });
    });

    it('adds only the NEW ids (skips already-selected) and reports the count', async () => {
      const { svc, writer } = make({
        categories: [
          { id: 'a', name: 'Paper' },
          { id: 'b', name: 'Copper' },
        ],
        selected: ['a'], // 'a' already on the list
      });
      const res: any = await svc.addCategories(FACTORY, ['a', 'b', 'b']); // dup 'b'
      // Only 'b' is written (a already there, b de-duplicated to one).
      expect(writer.addCategories).toHaveBeenCalledWith('acc1', Role.FACTORY, ['b']);
      expect(res.added).toBe(1);
    });

    it('writes nothing when every id is already selected', async () => {
      const { svc, writer } = make({
        categories: [{ id: 'a', name: 'Paper' }],
        selected: ['a'],
      });
      const res: any = await svc.addCategories(FACTORY, ['a']);
      expect(writer.addCategories).not.toHaveBeenCalled();
      expect(res.added).toBe(0);
    });
  });

  describe('list', () => {
    it('refuses a role with no category list', async () => {
      const { svc } = make();
      await expect(svc.list({ id: 'c1', role: Role.CITIZEN })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('returns an empty list when nothing is selected', async () => {
      const { svc, categoryRepo } = make({ selected: [] });
      const res = await svc.list(FACTORY);
      expect(res).toEqual({ categories: [] });
      expect(categoryRepo.find).not.toHaveBeenCalled();
    });

    it('returns the selected categories as id + name', async () => {
      const { svc } = make({
        selected: ['a', 'b'],
        categories: [
          { id: 'a', name: 'Paper' },
          { id: 'b', name: 'Copper' },
        ],
      });
      const res = await svc.list(FACTORY);
      expect(res).toEqual({
        categories: [
          { id: 'a', name: 'Paper' },
          { id: 'b', name: 'Copper' },
        ],
      });
    });
  });
});
