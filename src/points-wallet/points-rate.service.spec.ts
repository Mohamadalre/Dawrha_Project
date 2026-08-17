import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PointsRateService } from './points-rate.service';
import { Role } from '@src/user/enums/role.enum';

/**
 * The admin's money-per-point rate, per role: added, edited, and only for the
 * roles that actually trade.
 */
describe('PointsRateService', () => {
  const build = (existing: any = null) => {
    const saved: any[] = [];
    const rateRepo = {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn((v: any) => v),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (r: any) => { saved.push(r); return r; }),
    };
    const settings = { defaultCurrency: jest.fn().mockResolvedValue('SYP') };
    return { svc: new PointsRateService(rateRepo as any, settings as any), saved, rateRepo };
  };

  it('adds a rate for a trading role — currency from the central platform setting', async () => {
    const { svc, saved } = build(null);
    const res: any = await svc.create(Role.FACTORY, 1000, 'admin1');
    expect(res.result).toMatchObject({ role: Role.FACTORY, amount_per_point: 1000, currency: 'SYP' });
    expect(saved[0]).toMatchObject({ amountPerPoint: '1000' });
  });

  it('refuses a non-trading role (admin / collector)', async () => {
    const { svc } = build(null);
    await expect(svc.create(Role.ADMIN, 1000, 'a')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create(Role.COLLECTOR, 1000, 'a')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a zero or negative amount', async () => {
    const { svc } = build(null);
    await expect(svc.create(Role.FACTORY, 0, 'a')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('edits an existing rate in place', async () => {
    const { svc, saved } = build({ role: Role.FACTORY, amountPerPoint: '1000', currency: 'SYP' });
    await svc.update(Role.FACTORY, { amountPerPoint: 500 }, 'admin1');
    expect(saved[0]).toMatchObject({ amountPerPoint: '500' });
  });

  it('404s editing a rate that was never set', async () => {
    const { svc } = build(null);
    await expect(svc.update(Role.FACTORY, { amountPerPoint: 500 }, 'a')).rejects.toBeInstanceOf(NotFoundException);
  });
});
