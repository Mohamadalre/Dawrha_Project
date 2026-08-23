import { PointsWalletService, isWalletEligible } from './points-wallet.service';
import { Role } from '@src/user/enums/role.enum';

/**
 * Unit tests for the points-wallet rules the feature turns on:
 *   - who gets a wallet (the four trading roles, never admin/collector),
 *   - a wallet is created empty (0) and only once (idempotent),
 *   - a creation race is swallowed by reading the winner's row back,
 *   - a wallet failure never propagates out of an activation path,
 *   - the view route lazily creates a missing wallet.
 */
describe('PointsWalletService', () => {
  const makeRepo = () => ({
    findOne: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => ({ id: 'w1', ...v })),
  });

  const build = (repo: any, rates?: any, notifications?: any, stageRepo?: any) =>
    new PointsWalletService(
      repo as any,
      rates ?? ({ forRole: jest.fn().mockResolvedValue(null) } as any),
      notifications ?? ({ createNotification: jest.fn().mockResolvedValue({}) } as any),
      stageRepo ?? ({ find: jest.fn().mockResolvedValue([]) } as any),
      // Snapshot baseline: none by default → every row trends SAME.
      { previousRanks: jest.fn().mockResolvedValue(new Map()), refreshBaseline: jest.fn().mockResolvedValue(undefined) } as any,
    );

  describe('eligibility', () => {
    it('covers exactly the four trading roles', () => {
      expect(isWalletEligible(Role.CITIZEN)).toBe(true);
      expect(isWalletEligible(Role.INSTITUTIONS)).toBe(true);
      expect(isWalletEligible(Role.FACTORY)).toBe(true);
      expect(isWalletEligible(Role.EXTERNAL_PARTNER)).toBe(true);
    });

    it('excludes admin and collector', () => {
      expect(isWalletEligible(Role.ADMIN)).toBe(false);
      expect(isWalletEligible(Role.COLLECTOR)).toBe(false);
    });
  });

  describe('ensureForAccount', () => {
    it('creates an empty (0-point) wallet for an eligible account with none yet', async () => {
      const repo = makeRepo();
      repo.findOne.mockResolvedValue(null);
      const wallet = await build(repo).ensureForAccount('acc1', Role.CITIZEN);
      expect(repo.create).toHaveBeenCalledWith({ accountId: 'acc1', points: 0 });
      expect(repo.save).toHaveBeenCalled();
      expect(wallet).toMatchObject({ accountId: 'acc1', points: 0 });
    });

    it('is idempotent — returns the existing wallet without creating a second', async () => {
      const repo = makeRepo();
      repo.findOne.mockResolvedValue({ id: 'w1', accountId: 'acc1', points: 5 });
      const wallet = await build(repo).ensureForAccount('acc1', Role.FACTORY);
      expect(repo.save).not.toHaveBeenCalled();
      expect(wallet).toMatchObject({ id: 'w1', points: 5 });
    });

    it('returns null (and never touches the repo) for an ineligible role', async () => {
      const repo = makeRepo();
      const wallet = await build(repo).ensureForAccount('admin1', Role.ADMIN);
      expect(wallet).toBeNull();
      expect(repo.findOne).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('survives a creation race by reading the winner row back', async () => {
      const repo = makeRepo();
      // First lookup: none. Save loses the unique-constraint race. Second
      // lookup: the winner's row.
      repo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'w-winner', accountId: 'acc1', points: 0 });
      repo.save.mockRejectedValueOnce(new Error('duplicate key'));
      const wallet = await build(repo).ensureForAccount('acc1', Role.INSTITUTIONS);
      expect(wallet).toMatchObject({ id: 'w-winner' });
    });

    it('never throws out of an activation path — a DB failure returns null', async () => {
      const repo = makeRepo();
      repo.findOne.mockRejectedValue(new Error('db down'));
      await expect(
        build(repo).ensureForAccount('acc1', Role.CITIZEN),
      ).resolves.toBeNull();
    });
  });

  describe('view', () => {
    it('returns the balance shape for an existing wallet', async () => {
      const repo = makeRepo();
      repo.findOne.mockResolvedValue({ id: 'w1', accountId: 'acc1', points: 42 });
      const res = await build(repo).view('acc1', Role.CITIZEN);
      expect(res).toEqual({ points: 42, currency: 'POINTS', wallet_id: 'w1' });
    });

    it('lazily creates a missing wallet and reports 0', async () => {
      const repo = makeRepo();
      repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      const res = await build(repo).view('acc1', Role.FACTORY);
      expect(repo.save).toHaveBeenCalled();
      expect(res).toMatchObject({ points: 0, currency: 'POINTS' });
    });
  });

  describe('awardForOrder', () => {
    it('converts the order value at the role rate, credits the wallet, notifies', async () => {
      const repo = makeRepo();
      // Existing wallet with 5 points; a 3000 order at 1000-per-point earns 3.
      repo.findOne.mockResolvedValue({ id: 'w1', accountId: 'acc1', points: 5 });
      const rates = { forRole: jest.fn().mockResolvedValue({ amountPerPoint: '1000' }) };
      const notifications = { createNotification: jest.fn().mockResolvedValue({}) };

      const res = await build(repo, rates, notifications).awardForOrder('acc1', Role.FACTORY, 3000, 'ORD-1');

      expect(res).toEqual({ points: 3, balance: 8 });
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ points: 8 }));
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'acc1', args: expect.objectContaining({ points: 3 }) }),
      );
    });

    it('awards nothing when no rate is set for the role', async () => {
      const repo = makeRepo();
      const rates = { forRole: jest.fn().mockResolvedValue(null) };
      const res = await build(repo, rates).awardForOrder('acc1', Role.FACTORY, 3000, 'ORD-1');
      expect(res).toBeNull();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('awards FRACTIONAL points for an order smaller than one point (never floored)', async () => {
      const repo = makeRepo();
      repo.findOne.mockResolvedValue({ id: 'w1', accountId: 'acc1', points: 2 });
      const rates = { forRole: jest.fn().mockResolvedValue({ amountPerPoint: '1000' }) };
      // 500 / 1000 = 0.5 — credited, not dropped to 0.
      const res = await build(repo, rates).awardForOrder('acc1', Role.FACTORY, 500, 'ORD-1');
      expect(res).toEqual({ points: 0.5, balance: 2.5 });
    });
  });

  describe('leaderboard', () => {
    it('ranks users by points (highest first), paginated, with the caller rank', async () => {
      const rows = [
        { accountId: 'a1', points: 100, account: { name: 'Alice', role: Role.CITIZEN } },
        { accountId: 'a2', points: 50, account: { name: 'Bob', role: Role.FACTORY } },
      ];
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(rows),
        getCount: jest.fn().mockResolvedValue(2),
        // The caller (Bob) resolved as an active CITIZEN wallet for the `me` block.
        getOne: jest.fn().mockResolvedValue({ accountId: 'a2', points: 50, createdAt: new Date() }),
      };
      const repo = makeRepo();
      (repo as any).createQueryBuilder = jest.fn(() => qb);
      // Both users (100 and 50) fall in the "Silver" band → their stage name.
      const stageRepo = {
        find: jest.fn().mockResolvedValue([
          { name: 'Silver', minPoints: 50, maxPoints: 150, sortOrder: 1 },
        ]),
      };

      const res: any = await build(repo, undefined, undefined, stageRepo).leaderboard(1, 20, 'a2');

      expect(res.leaderboard[0]).toMatchObject({ rank: 1, name: 'Alice', points: 100, stage: 'Silver' });
      expect(res.leaderboard[1]).toMatchObject({ rank: 2, name: 'Bob', points: 50, stage: 'Silver' });
      expect(res.pagination).toMatchObject({ total: 2, page: 1, limit: 20 });
      // The caller's own standing, with their stage name.
      expect(res.me).toMatchObject({ points: 50, stage: 'Silver' });
    });

    it('returns me = null for an account that holds no wallet', async () => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
        getCount: jest.fn().mockResolvedValue(0),
        getOne: jest.fn().mockResolvedValue(null), // caller is not an active citizen
      };
      const repo = makeRepo();
      (repo as any).createQueryBuilder = jest.fn(() => qb);

      const res: any = await build(repo).leaderboard(1, 20, 'admin1');
      expect(res.me).toBeNull();
      expect(res.leaderboard).toEqual([]);
    });
  });
});
