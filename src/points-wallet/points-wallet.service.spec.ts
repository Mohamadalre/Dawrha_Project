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

  const build = (repo: any) => new PointsWalletService(repo as any);

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
});
