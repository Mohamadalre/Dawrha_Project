import { OrderConstraintsController } from './order-constraints.controller';
import { SpendingCapPeriod } from './enums/spending-cap-period.enum';
import { Role } from '@src/user/enums/role.enum';

/** The controller is a thin mapper — assert it forwards to the right service. */
describe('OrderConstraintsController', () => {
  let controller: OrderConstraintsController;
  let minimums: any;
  let caps: any;
  const admin = { id: 'admin1' };

  beforeEach(() => {
    minimums = {
      list: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockImplementation((_r, v) => Promise.resolve(v)),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    caps = {
      list: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockImplementation((_r, v) => Promise.resolve(v)),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    controller = new OrderConstraintsController(minimums, caps);
  });

  it('sets a minimum, mapping the DTO to the service shape', async () => {
    await controller.setMinimum(admin, Role.FACTORY, {
      min_order_value: 50,
      currency: 'JOD',
      is_active: true,
    });
    expect(minimums.upsert).toHaveBeenCalledWith(
      Role.FACTORY,
      { minOrderValue: 50, currency: 'JOD', isActive: true },
      'admin1',
    );
  });

  it('sets a spending cap, mapping the DTO to the service shape', async () => {
    await controller.setCap(admin, Role.EXTERNAL_PARTNER, {
      max_amount: 1000,
      period: SpendingCapPeriod.DAILY,
      is_active: true,
    });
    expect(caps.upsert).toHaveBeenCalledWith(
      Role.EXTERNAL_PARTNER,
      { maxAmount: 1000, period: SpendingCapPeriod.DAILY, currency: undefined, isActive: true },
      'admin1',
    );
  });

  it('lists both floors and ceilings', async () => {
    await controller.listMinimums();
    await controller.listCaps();
    expect(minimums.list).toHaveBeenCalled();
    expect(caps.list).toHaveBeenCalled();
  });

  it('removes a cap by role', async () => {
    await controller.removeCap(Role.FACTORY);
    expect(caps.remove).toHaveBeenCalledWith(Role.FACTORY);
  });
});
