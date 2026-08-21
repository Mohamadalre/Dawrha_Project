import { NotFoundException } from '@nestjs/common';
import { OrderMinimumService } from './order-minimum.service';
import { Role } from '@src/user/enums/role.enum';

/**
 * The floor logic, per role: no configured minimum passes anything, a value at
 * or above the floor passes, and a value below it fails with the shortfall the
 * buyer needs to add.
 */
describe('OrderMinimumService', () => {
  let service: OrderMinimumService;
  let repo: any;

  const min = (over: any = {}) => ({
    role: Role.FACTORY,
    minOrderValue: '50',
    currency: 'JOD',
    isActive: true,
    ...over,
  });

  beforeEach(() => {
    repo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(), delete: jest.fn() };
    service = new OrderMinimumService(repo, { defaultCurrency: jest.fn().mockResolvedValue('SYP') } as any);
  });

  it('passes any value when no minimum is configured (null = no floor)', async () => {
    repo.findOne.mockResolvedValue(null);
    const res = await service.check(Role.FACTORY, 5);
    expect(res.passed).toBe(true);
    expect(res.required).toBe(0);
  });

  it('passes when the goods total is at or above the floor', async () => {
    repo.findOne.mockResolvedValue(min({ minOrderValue: '50' }));
    const res = await service.check(Role.FACTORY, 50);
    expect(res.passed).toBe(true);
    expect(res.shortfall).toBe(0);
  });

  it('fails below the floor and reports the shortfall', async () => {
    repo.findOne.mockResolvedValue(min({ minOrderValue: '50' }));
    const res = await service.check(Role.FACTORY, 30);
    expect(res.passed).toBe(false);
    expect(res.required).toBe(50);
    expect(res.shortfall).toBe(20);
  });

  it('holds different roles to their own floor', async () => {
    repo.findOne.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.role === Role.FACTORY
          ? min({ role: Role.FACTORY, minOrderValue: '50' })
          : min({ role: Role.EXTERNAL_PARTNER, minOrderValue: '200' }),
      ),
    );

    const factory = await service.check(Role.FACTORY, 100); // ≥ 50
    const freeFacility = await service.check(Role.EXTERNAL_PARTNER, 100); // < 200
    expect(factory.passed).toBe(true);
    expect(freeFacility.passed).toBe(false);
    expect(freeFacility.shortfall).toBe(100);
  });

  it('remove throws when there is no minimum for the role', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.remove(Role.CITIZEN)).rejects.toBeInstanceOf(NotFoundException);
  });
});
