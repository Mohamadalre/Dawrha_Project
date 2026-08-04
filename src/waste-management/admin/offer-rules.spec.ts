import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdminCatalogService } from './admin-catalog.service';
import { Role } from '@src/user/enums/role.enum';

/**
 * Which CONDITION an offer may name, and who it may be aimed at.
 *
 * The rule follows how each buyer is actually priced. A factory or free
 * facility buys a GRADE — "excellent" and "poor" of the same material are
 * different goods at different prices — so an offer that names no grade would
 * discount all of them at once. An institution or citizen buys the material
 * flat, so a condition on their offer describes a distinction their price list
 * does not have.
 */
describe('offer condition + audience rules', () => {
  let service: AdminCatalogService;
  let offerRepo: any;
  let conditions: any;
  let productRepo: any;

  const GRADED = 'prod-graded';

  const build = () => {
    productRepo = { findOne: jest.fn().mockResolvedValue({ id: GRADED }) };
    offerRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'off-1', ...x })),
      findOne: jest.fn(),
    };
    conditions = {
      hasConditions: jest.fn().mockResolvedValue(true),
      validateActiveCode: jest.fn(async (_p: string, c: string) => c.toUpperCase()),
    };
    const noop = { invalidate: jest.fn(), record: jest.fn() };
    service = new AdminCatalogService(
      {} as any, productRepo, {} as any, {} as any, {} as any, {} as any,
      {} as any, offerRepo, {} as any, noop as any, noop as any, {} as any,
      conditions,
    );
  };

  beforeEach(build);

  const create = (over: any = {}) =>
    service.createOffer('admin-1', {
      product_id: GRADED,
      offer_price: 50,
      ...over,
    } as any);

  // ── graded buyers MUST name the grade ──────────────────────────────────
  it('refuses a factory offer on a graded material with no condition', async () => {
    await expect(create({ target_roles: [Role.FACTORY] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a free-facility offer with no condition', async () => {
    await expect(
      create({ target_roles: [Role.EXTERNAL_PARTNER] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a factory offer that names one', async () => {
    const res = await create({ target_roles: [Role.FACTORY], condition: 'excellent' });
    expect(res.offer).toBeDefined();
    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ conditionCode: 'EXCELLENT' }),
    );
  });

  it('allows a factory offer on a material with no grades at all', async () => {
    // Nothing to name — so the requirement does not apply.
    conditions.hasConditions.mockResolvedValue(false);

    const res = await create({ target_roles: [Role.FACTORY] });

    expect(res.offer).toBeDefined();
  });

  // ── flat buyers must NOT name one ──────────────────────────────────────
  it('refuses a condition on an institution offer', async () => {
    await expect(
      create({ target_roles: [Role.INSTITUTIONS], condition: 'excellent' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a condition on a citizen offer', async () => {
    await expect(
      create({ target_roles: [Role.CITIZEN], condition: 'excellent' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a single flat price for institutions', async () => {
    const res = await create({ target_roles: [Role.INSTITUTIONS] });

    expect(offerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ conditionCode: null }),
    );
    expect(res.offer).toBeDefined();
  });

  it('refuses a condition on an UNTARGETED offer', async () => {
    // It would reach citizens too, for whom the grade means nothing.
    await expect(create({ condition: 'excellent' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // ── several grades of the same material: allowed ───────────────────────
  it('allows a factory to hold offers on DIFFERENT conditions of one material', async () => {
    offerRepo.find.mockResolvedValue([
      { id: 'a', conditionCode: 'EXCELLENT', targetRoles: [Role.FACTORY], isActive: true },
    ]);

    const res = await create({ target_roles: [Role.FACTORY], condition: 'good' });

    expect(res.offer).toBeDefined();
  });

  it('refuses a SECOND live offer on the same condition and audience', async () => {
    // Two live offers on the same grade have no defined winner — the price a
    // buyer sees would depend on whichever the sort happened to surface.
    offerRepo.find.mockResolvedValue([
      { id: 'a', conditionCode: 'GOOD', targetRoles: [Role.FACTORY], isActive: true },
    ]);

    await expect(
      create({ target_roles: [Role.FACTORY], condition: 'good' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('ignores an EXPIRED offer when checking for duplicates', async () => {
    offerRepo.find.mockResolvedValue([
      {
        id: 'a',
        conditionCode: 'GOOD',
        targetRoles: [Role.FACTORY],
        isActive: true,
        validUntil: new Date(Date.now() - 60_000),
      },
    ]);

    const res = await create({ target_roles: [Role.FACTORY], condition: 'good' });

    expect(res.offer).toBeDefined();
  });

  // ── the rules survive an EDIT ──────────────────────────────────────────
  it('refuses retargeting a graded offer at citizens', async () => {
    // The bypass the create-only check would have left open.
    offerRepo.findOne.mockResolvedValue({
      id: 'off-9',
      productId: GRADED,
      conditionCode: 'EXCELLENT',
      targetRoles: [Role.FACTORY],
      isActive: true,
    });

    await expect(
      service.updateOffer('admin-1', 'off-9', { target_roles: [Role.CITIZEN] } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses moving an offer onto a condition that already has one', async () => {
    offerRepo.findOne.mockResolvedValue({
      id: 'off-9',
      productId: GRADED,
      conditionCode: 'EXCELLENT',
      targetRoles: [Role.FACTORY],
      isActive: true,
    });
    offerRepo.find.mockResolvedValue([
      { id: 'other', conditionCode: 'GOOD', targetRoles: [Role.FACTORY], isActive: true },
      { id: 'off-9', conditionCode: 'EXCELLENT', targetRoles: [Role.FACTORY], isActive: true },
    ]);

    await expect(
      service.updateOffer('admin-1', 'off-9', { condition: 'good' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
