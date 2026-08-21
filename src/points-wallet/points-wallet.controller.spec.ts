import { ForbiddenException } from '@nestjs/common';
import { PointsWalletController } from './points-wallet.controller';
import { Role } from '@src/user/enums/role.enum';

/**
 * The leaderboard route is for USER (citizen) accounts only — every other role
 * is refused before the service is ever called.
 */
describe('PointsWalletController — leaderboard access', () => {
  const build = () => {
    const wallet = { leaderboard: jest.fn().mockResolvedValue({ me: null, leaderboard: [] }) };
    return { ctrl: new PointsWalletController(wallet as any), wallet };
  };

  it('lets a CITIZEN through to the leaderboard', async () => {
    const { ctrl, wallet } = build();
    const res = await ctrl.leaderboard(
      { id: 'u1', role: Role.CITIZEN },
      { page: 1, limit: 20 } as any,
    );
    expect(wallet.leaderboard).toHaveBeenCalledWith(1, 20, 'u1');
    expect(res.message).toBeDefined();
  });

  it.each([Role.FACTORY, Role.INSTITUTIONS, Role.EXTERNAL_PARTNER, Role.COLLECTOR, Role.ADMIN])(
    'refuses a %s with 403 and never touches the service',
    async (role) => {
      const { ctrl, wallet } = build();
      await expect(
        ctrl.leaderboard({ id: 'x', role }, { page: 1, limit: 20 } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(wallet.leaderboard).not.toHaveBeenCalled();
    },
  );
});
