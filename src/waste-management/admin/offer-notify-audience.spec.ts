import { In } from 'typeorm';
import { AdminCatalogService } from './admin-catalog.service';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { AUDIENCE_ROLES, OfferAudience } from '../enums/offer-audience.enum';
import { Role } from '@src/user/enums/role.enum';

/**
 * Feature 1: adding an offer on a material notifies every ACTIVE account whose
 * role the offer targets. These tests drive `notifyOfferAudience` directly.
 */
describe('AdminCatalogService.notifyOfferAudience', () => {
  let accountRepo: { find: jest.Mock };
  let notifications: {
    createNotification: jest.Mock;
    enqueueNotification: jest.Mock;
  };
  let service: AdminCatalogService;

  const noop = {} as any;
  const product = { id: 'prod-1', name: 'PET Bottles' } as any;

  beforeEach(() => {
    accountRepo = { find: jest.fn().mockResolvedValue([]) };
    notifications = {
      createNotification: jest.fn().mockResolvedValue({ id: 'n1' }),
      enqueueNotification: jest.fn().mockResolvedValue(undefined),
    };
    // 18 positional deps — only the last two (accountRepo, notifications) matter
    // for this method; the rest are unused here.
    service = new AdminCatalogService(
      noop, noop, noop, noop, noop, noop, noop, noop,
      noop, noop, noop, noop, noop, noop, noop, noop,
      accountRepo as any,
      notifications as any,
    );
  });

  const call = (offers: any[]) =>
    (service as any).notifyOfferAudience(product, offers);

  it('targets the offer’s explicit roles and only ACTIVE accounts', async () => {
    accountRepo.find.mockResolvedValue([{ id: 'acc-1' }, { id: 'acc-2' }]);

    await call([{ audience: OfferAudience.BUYERS, targetRoles: [Role.FACTORY] }]);

    expect(accountRepo.find).toHaveBeenCalledTimes(1);
    const where = accountRepo.find.mock.calls[0][0].where;
    expect(where.accountStatus).toBe(AccountStatus.ACTIVE);
    // In([Role.FACTORY])
    expect(where.role).toEqual(In([Role.FACTORY]));

    expect(notifications.createNotification).toHaveBeenCalledTimes(2);
    expect(notifications.enqueueNotification).toHaveBeenCalledTimes(2);
    const payload = notifications.createNotification.mock.calls[0][0];
    expect(payload).toMatchObject({
      userId: 'acc-1',
      titleKey: 'notifications.newOffer.title',
      bodyKey: 'notifications.newOffer.body',
      args: { product: 'PET Bottles' },
    });
    expect(payload.body).toContain('PET Bottles');
  });

  it('falls back to the whole audience when the offer has no explicit roles', async () => {
    accountRepo.find.mockResolvedValue([{ id: 'acc-1' }]);

    await call([{ audience: OfferAudience.SELLERS, targetRoles: null }]);

    const where = accountRepo.find.mock.calls[0][0].where;
    expect(where.role).toEqual(In(AUDIENCE_ROLES[OfferAudience.SELLERS]));
  });

  it('merges the roles of several offer rows into one recipient query (deduped)', async () => {
    await call([
      { audience: OfferAudience.BUYERS, targetRoles: [Role.FACTORY] },
      { audience: OfferAudience.BUYERS, targetRoles: [Role.FACTORY, Role.EXTERNAL_PARTNER] },
    ]);

    const where = accountRepo.find.mock.calls[0][0].where;
    // Set-deduped to the two distinct roles.
    expect(where.role).toEqual(In([Role.FACTORY, Role.EXTERNAL_PARTNER]));
  });

  it('does nothing (no query) when no roles resolve', async () => {
    await call([{ audience: OfferAudience.BUYERS, targetRoles: [] }]);
    // empty targetRoles -> falls back to audience roles, so it DOES query;
    // to prove the guard, use an unknown audience with no mapping:
    accountRepo.find.mockClear();
    await call([{ audience: 'UNKNOWN' as any, targetRoles: [] }]);
    expect(accountRepo.find).not.toHaveBeenCalled();
  });

  it('is best-effort: one failing recipient does not stop the others', async () => {
    accountRepo.find.mockResolvedValue([{ id: 'acc-1' }, { id: 'acc-2' }]);
    notifications.createNotification
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 'n2' });

    await expect(call([{ audience: OfferAudience.BUYERS, targetRoles: [Role.FACTORY] }]))
      .resolves.toBeUndefined();

    // Second recipient still processed despite the first throwing.
    expect(notifications.createNotification).toHaveBeenCalledTimes(2);
    expect(notifications.enqueueNotification).toHaveBeenCalledWith('n2');
  });

  it('never throws back to the caller even if the account query fails', async () => {
    accountRepo.find.mockRejectedValue(new Error('db down'));
    await expect(call([{ audience: OfferAudience.BUYERS, targetRoles: [Role.FACTORY] }]))
      .resolves.toBeUndefined();
  });
});
