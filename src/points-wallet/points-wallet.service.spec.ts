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

  const build = (repo: any, rates?: any, notifications?: any) =>
    new PointsWalletService(
      repo as any,
      rates ?? ({ forRole: jest.fn().mockResolvedValue(null) } as any),
      notifications ?? ({ createNotification: jest.fn().mockResolvedValue({}) } as any),
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

    it('awards no points when the order is too small to earn one', async () => {
      const repo = makeRepo();
      repo.findOne.mockResolvedValue({ id: 'w1', accountId: 'acc1', points: 2 });
      const rates = { forRole: jest.fn().mockResolvedValue({ amountPerPoint: '1000' }) };
      const res = await build(repo, rates).awardForOrder('acc1', Role.FACTORY, 500, 'ORD-1');
      expect(res).toEqual({ points: 0, balance: 2 });
    });
  });
});
