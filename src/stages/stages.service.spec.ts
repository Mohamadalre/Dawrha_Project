import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StagesService } from './stages.service';
import { Role } from '@src/user/enums/role.enum';

/**
 * Points stages (مراحل) — the citizen loyalty ladder.
 *
 * The rules pinned here are the ones the admin depends on and the ones a user
 * would notice if they broke:
 *   - a new stage is APPENDED automatically (the admin never numbers it), needs
 *     an image, and cannot reuse another stage's name or points band;
 *   - a user is told, in words, which stage they are in — or that they are in
 *     none yet;
 *   - the admin sees how many users each stage holds, which is what makes a
 *     delete a decision rather than a surprise.
 */
describe('StagesService', () => {
  let stageRepo: any;
  let walletRepo: any;
  let cloudinary: any;
  let dataSource: any;
  let service: StagesService;
  let store: any[]; // in-memory stages for reorder/delete result checks

  const qb = (over: any = {}) => {
    const o: any = {
      where: jest.fn(() => o),
      andWhere: jest.fn(() => o),
      innerJoin: jest.fn(() => o),
      orderBy: jest.fn(() => o),
      update: jest.fn(() => o),
      set: jest.fn(() => o),
      getOne: jest.fn().mockResolvedValue(null),
      getCount: jest.fn().mockResolvedValue(0),
      execute: jest.fn().mockResolvedValue({}),
      ...over,
    };
    return o;
  };

  beforeEach(() => {
    store = [];
    stageRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      count: jest.fn(async () => store.length),
      createQueryBuilder: jest.fn(() => qb()),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => {
        const row = { id: x.id ?? `s-${store.length + 1}`, ...x };
        store.push(row);
        return row;
      }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    walletRepo = {
      findOne: jest.fn().mockResolvedValue({ points: 0 }),
      createQueryBuilder: jest.fn(() => qb({ getCount: jest.fn().mockResolvedValue(3) })),
    };
    cloudinary = { deleteByUrl: jest.fn().mockResolvedValue(undefined) };
    dataSource = {
      transaction: jest.fn(async (cb: any) =>
        cb({ getRepository: () => stageRepo }),
      ),
    };
    service = new StagesService(stageRepo, walletRepo, cloudinary, dataSource);
  });

  const createDto = (over: any = {}) => ({
    name: 'Bronze',
    minPoints: 0,
    maxPoints: 100,
    ...over,
  });

  // ── Create ────────────────────────────────────────────────────────
  it('appends a new stage automatically (order = count + 1), no manual order', async () => {
    stageRepo.count.mockResolvedValue(2); // two stages already
    const res: any = await service.create(createDto(), 'http://img/badge.png');
    expect(res.result.order).toBe(3);
  });

  it('requires an image', async () => {
    await expect(service.create(createDto(), null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a duplicate name (case-insensitive)', async () => {
    stageRepo.findOne.mockResolvedValue({ id: 'x', name: 'bronze' });
    await expect(
      service.create(createDto({ name: 'Bronze' }), 'http://img/b.png'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a points band that overlaps another stage', async () => {
    stageRepo.createQueryBuilder.mockReturnValue(
      qb({ getOne: jest.fn().mockResolvedValue({ name: 'Silver', minPoints: 50, maxPoints: 150 }) }),
    );
    await expect(
      service.create(createDto({ minPoints: 100, maxPoints: 200 }), 'http://img/b.png'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a reversed band (min > max)', async () => {
    await expect(
      service.create(createDto({ minPoints: 200, maxPoints: 100 }), 'http://img/b.png'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── Update ────────────────────────────────────────────────────────
  it('refuses renaming a stage to another stage’s name', async () => {
    stageRepo.findOne
      .mockResolvedValueOnce({ id: 's-1', name: 'Bronze', minPoints: 0, maxPoints: 100, sortOrder: 1 }) // the stage
      .mockResolvedValueOnce({ id: 's-2', name: 'Silver' }); // the clash
    await expect(
      service.update('s-1', { name: 'Silver' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── My stage (the user's view) ────────────────────────────────────
  it('tells the user which stage they are in', async () => {
    walletRepo.findOne.mockResolvedValue({ points: 75 });
    stageRepo.createQueryBuilder.mockReturnValue(
      qb({ getOne: jest.fn().mockResolvedValue({ id: 's-1', name: 'Bronze', minPoints: 0, maxPoints: 100, sortOrder: 1, isActive: true }) }),
    );
    const res: any = await service.myStage('acc-1');
    expect(res.current_stage.name).toBe('Bronze');
    expect(res.message).toContain('Bronze');
  });

  it('tells a user with no stage they are in none yet', async () => {
    walletRepo.findOne.mockResolvedValue({ points: 5 });
    // no matching band
    const res: any = await service.myStage('acc-1');
    expect(res.current_stage).toBeNull();
    expect(res.message).toContain('not in any stage');
  });

  // ── The ladder, as a user sees it ─────────────────────────────────
  it('lists active stages for a user and flags their current one', async () => {
    walletRepo.findOne.mockResolvedValue({ points: 120 });
    stageRepo.find.mockResolvedValue([
      { id: 's-1', name: 'Bronze', minPoints: 0, maxPoints: 100, sortOrder: 1, isActive: true },
      { id: 's-2', name: 'Silver', minPoints: 101, maxPoints: 200, sortOrder: 2, isActive: true },
    ]);
    const res: any = await service.listForUser('acc-1');
    expect(res.current_stage_id).toBe('s-2');
    expect(res.stages.find((s: any) => s.id === 's-2').is_current).toBe(true);
    expect(res.stages.find((s: any) => s.id === 's-1').is_current).toBe(false);
  });

  // ── Admin list: user counts per stage ─────────────────────────────
  it('reports how many users each stage holds', async () => {
    stageRepo.findAndCount.mockResolvedValue([
      [{ id: 's-1', name: 'Bronze', minPoints: 0, maxPoints: 100, sortOrder: 1, isActive: true }],
      1,
    ]);
    const res: any = await service.list({ page: 1, limit: 20, status: 'all' } as any);
    expect(res.stages[0].user_count).toBe(3); // walletRepo getCount → 3
  });

  // ── Delete is safe even with users in the band ────────────────────
  it('deletes a stage and closes the order gap (users are computed, never orphaned)', async () => {
    stageRepo.findOne.mockResolvedValue({ id: 's-2', name: 'Silver', sortOrder: 2 });
    const res: any = await service.remove('s-2');
    expect(res.result.id).toBe('s-2');
    expect(stageRepo.delete).toHaveBeenCalledWith('s-2');
  });

  it('404s deleting a stage that does not exist', async () => {
    stageRepo.findOne.mockResolvedValue(null);
    await expect(service.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  // ── Cloudinary cleanup: the old image never lingers ───────────────
  it('deletes the OLD image from Cloudinary when the image is replaced', async () => {
    stageRepo.findOne.mockResolvedValue({
      id: 's-1', name: 'Bronze', imageUrl: 'https://res.cloudinary.com/x/old.png',
      minPoints: 0, maxPoints: 100, sortOrder: 1,
    });
    await service.update('s-1', {}, 'https://res.cloudinary.com/x/new.png');
    expect(cloudinary.deleteByUrl).toHaveBeenCalledWith('https://res.cloudinary.com/x/old.png');
  });

  it('does NOT delete anything when the image is unchanged', async () => {
    stageRepo.findOne.mockResolvedValue({
      id: 's-1', name: 'Bronze', imageUrl: 'https://res.cloudinary.com/x/old.png',
      minPoints: 0, maxPoints: 100, sortOrder: 1,
    });
    await service.update('s-1', { isActive: false }); // no new image, no rename
    expect(cloudinary.deleteByUrl).not.toHaveBeenCalled();
  });

  it('deletes the stage image from Cloudinary on delete', async () => {
    stageRepo.findOne.mockResolvedValue({
      id: 's-2', name: 'Silver', sortOrder: 2,
      imageUrl: 'https://res.cloudinary.com/x/silver.png',
    });
    await service.remove('s-2');
    expect(cloudinary.deleteByUrl).toHaveBeenCalledWith('https://res.cloudinary.com/x/silver.png');
  });

  // ── Reorder is a MOVE (shift), not a swap ─────────────────────────
  it('reorder shifts the block between old and new position (up-move)', async () => {
    // A stage at position 3 moved to position 1: the block [1,2] slides DOWN by
    // one, then the stage takes position 1. This keeps 1..N contiguous — a move,
    // which for two adjacent stages reads exactly as a swap.
    stageRepo.findOne.mockResolvedValue({ id: 's-3', sortOrder: 3 });
    stageRepo.count.mockResolvedValue(3);
    const moveQb = qb();
    stageRepo.createQueryBuilder.mockReturnValue(moveQb);

    await service.reorder('s-3', 1);

    // The shift ran (block moved), and the stage landed on its new number.
    expect(moveQb.set).toHaveBeenCalled();
    expect(stageRepo.update).toHaveBeenCalledWith('s-3', { sortOrder: 1 });
  });

  // ── myStage rank within the stage (CITIZENS only) ─────────────────
  it('returns a CITIZEN caller rank within their own stage (highest points first)', async () => {
    // The caller has 80 points and lands in "Silver" (50–150).
    walletRepo.findOne.mockResolvedValue({ points: 80 });
    stageRepo.createQueryBuilder.mockReturnValue(
      qb({
        getOne: jest.fn().mockResolvedValue({
          id: 's2', name: 'Silver', minPoints: 50, maxPoints: 150,
          sortOrder: 2, isActive: true,
        }),
      }),
    );
    // First wallet query = citizens in the band (20); second = those ahead (2).
    walletRepo.createQueryBuilder
      .mockReturnValueOnce(qb({ getCount: jest.fn().mockResolvedValue(20) }))
      .mockReturnValueOnce(qb({ getCount: jest.fn().mockResolvedValue(2) }));

    const res: any = await service.myStage('acc1', Role.CITIZEN);

    expect(res.current_stage.name).toBe('Silver');
    expect(res.stage_users_count).toBe(20);
    expect(res.stage_rank).toBe(3); // 2 ahead + 1
  });

  it('gives a NON-citizen no rank even when they fall in a stage band', async () => {
    walletRepo.findOne.mockResolvedValue({ points: 80 });
    stageRepo.createQueryBuilder.mockReturnValue(
      qb({
        getOne: jest.fn().mockResolvedValue({
          id: 's2', name: 'Silver', minPoints: 50, maxPoints: 150,
          sortOrder: 2, isActive: true,
        }),
      }),
    );
    const res: any = await service.myStage('acc1', Role.FACTORY);
    expect(res.current_stage.name).toBe('Silver'); // still classified
    expect(res.stage_rank).toBeNull();             // but not ranked
    expect(res.stage_users_count).toBe(0);
  });

  it('has no rank when the caller is in no stage', async () => {
    walletRepo.findOne.mockResolvedValue({ points: 5 });
    stageRepo.createQueryBuilder.mockReturnValue(
      qb({ getOne: jest.fn().mockResolvedValue(null) }),
    );
    const res: any = await service.myStage('acc1', Role.CITIZEN);
    expect(res.current_stage).toBeNull();
    expect(res.stage_rank).toBeNull();
    expect(res.stage_users_count).toBe(0);
  });
});
