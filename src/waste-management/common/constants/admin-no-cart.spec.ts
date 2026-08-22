import { ROLE_PERMISSIONS_MAP } from './permissions';
import { Role } from '@src/user/enums/role.enum';

/**
 * The admin runs the platform; they do not hold a basket. So the ADMIN role must
 * NOT carry the cart permissions — no view, no add, no clear — while every buyer
 * role still does. This pins the one deliberate exception to "admin has every
 * waste permission", so a future edit cannot quietly hand the cart back.
 */
describe('cart permissions by role', () => {
  const CART = ['cart.view', 'cart.manage'];

  it('the ADMIN holds NEITHER cart permission', () => {
    const admin = ROLE_PERMISSIONS_MAP[Role.ADMIN] ?? [];
    for (const key of CART) expect(admin).not.toContain(key);
  });

  it('the ADMIN still holds other waste permissions (it is not empty)', () => {
    const admin = ROLE_PERMISSIONS_MAP[Role.ADMIN] ?? [];
    expect(admin).toContain('waste.products.view');
    expect(admin.length).toBeGreaterThan(5);
  });

  it.each([Role.CITIZEN, Role.INSTITUTIONS, Role.FACTORY, Role.EXTERNAL_PARTNER])(
    'the buyer role %s holds both cart permissions',
    (role) => {
      const perms = ROLE_PERMISSIONS_MAP[role] ?? [];
      for (const key of CART) expect(perms).toContain(key);
    },
  );
});
