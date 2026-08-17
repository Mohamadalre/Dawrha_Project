import { ConflictException } from '@nestjs/common';
import { OdooAdminAccountController } from './odoo-admin-account.controller';

/**
 * The Odoo admin account routes managed from the backend:
 *   - edit PROFILE ONLY (name / email / phone) — never the password;
 *   - CREATE an additional admin via the invite model — no password handled.
 */
describe('OdooAdminAccountController', () => {
  const build = (odooOver: any = {}) => {
    const odoo = {
      updateConnectedAdminUser: jest.fn().mockResolvedValue({ id: 1, name: 'A', login: 'a', email: null, phone: null }),
      createAdminUser: jest.fn().mockResolvedValue({ id: 7, login: 'newadmin' }),
      updateAdminCredentials: jest.fn(),
      ...odooOver,
    };
    const account = { id: 'acc1', name: 'Old', email: 'old@x.com', phone: '' };
    const accountRepo = {
      findOne: jest.fn().mockResolvedValue(account),
      save: jest.fn(async (a: any) => a),
    };
    return {
      ctrl: new OdooAdminAccountController(odoo as any, accountRepo as any),
      odoo,
      account,
      accountRepo,
    };
  };

  describe('update (profile only)', () => {
    it('writes name/email/phone and NEVER touches credentials', async () => {
      const { ctrl, odoo, accountRepo } = build();

      const res = await ctrl.update({ id: 'acc1' } as any, {
        name: 'New',
        email: 'new@x.com',
        phone: '0999',
      } as any);

      expect(odoo.updateConnectedAdminUser).toHaveBeenCalledWith({
        name: 'New',
        email: 'new@x.com',
        phone: '0999',
      });
      // The password/login rotation path is gone entirely.
      expect(odoo.updateAdminCredentials).not.toHaveBeenCalled();
      expect(accountRepo.save).toHaveBeenCalled();
      expect(res.result).not.toHaveProperty('credentials_updated');
    });
  });

  describe('createAdmin (invite model)', () => {
    it('creates the Odoo admin and returns it — no password in play', async () => {
      const { ctrl, odoo } = build();

      const res = await ctrl.createAdmin({
        name: 'Second Admin',
        login: 'newadmin',
        email: 'second@x.com',
      } as any);

      expect(odoo.createAdminUser).toHaveBeenCalledWith({
        name: 'Second Admin',
        login: 'newadmin',
        email: 'second@x.com',
        phone: undefined,
      });
      expect(res.result.odoo).toEqual({ id: 7, login: 'newadmin' });
    });

    it('maps a duplicate login to a clean 409', async () => {
      const { ctrl } = build({
        createAdminUser: jest.fn().mockRejectedValue(new Error('The login must be unique')),
      });

      await expect(
        ctrl.createAdmin({ name: 'Dup', login: 'admin' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
