import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductConditionsService } from './product-conditions.service';

/**
 * Addressing a grade.
 *
 * A grade belongs to exactly ONE material, so its id identifies it completely.
 * The material segment in `/products/:productId/conditions/:conditionId` was
 * therefore redundant — and, because nothing checked it, actively harmful:
 * `/products/A/conditions/x` edited a grade of material B while the URL in the
 * log said otherwise. A path segment that can disagree with the record and is
 * never challenged is not context, it is a lie waiting to be believed.
 *
 * These tests pin both halves of the fix: the id alone works, and the pairing is
 * now asserted when it is supplied.
 */
describe('ProductConditionsService — addressing a grade', () => {
  let conditionRepo: any;
  let productRepo: any;
  let pricingRepo: any;
  let historyRepo: any;
  let offerRepo: any;
  let inventoryRepo: any;
  let odooSync: any;
  let service: ProductConditionsService;

  const CONDITION = {
    id: 'cond-1',
    productId: 'prod-A',
    code: 'PREMIUM',
    nameEn: 'Premium',
    nameAr: 'ممتاز',
    sortOrder: 1,
    isActive: true,
  };

  beforeEach(() => {
    conditionRepo = {
      findOne: jest.fn().mockResolvedValue({ ...CONDITION }),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (c) => c),
      create: jest.fn((v) => v),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ max: '0' }),
      })),
    };
    productRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'prod-A', name: 'PET' }),
    };
    pricingRepo = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      remove: jest.fn(),
    };
    // A grade's live price is archived here before it is deleted with the grade.
    historyRepo = { save: jest.fn(), create: jest.fn((v) => v) };
    // Deleting a grade takes its offers down with it; grading a material also
    // sweeps out conditionless BUYERS offers.
    offerRepo = {
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      remove: jest.fn(),
    };
    // Deleting a grade has to know whether any of it is still on a shelf.
    inventoryRepo = {
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
      })),
    };
    odooSync = {
      enqueueSyncCondition: jest.fn(),
      enqueueDeleteCondition: jest.fn(),
      enqueueUpdatePricing: jest.fn(),
    };

    // Inside a transaction the service asks for a repo PER entity. Route each to
    // the mock that stands in for it so a cascade delete can be asserted.
    const manager = {
      getRepository: (entity: any) => {
        const name = entity?.name ?? '';
        if (name === 'ProductPricing') return pricingRepo;
        if (name === 'ProductPricingHistory') return historyRepo;
        if (name === 'Offer') return offerRepo;
        return conditionRepo; // MaterialCondition
      },
    };

    service = new ProductConditionsService(
      conditionRepo,
      productRepo,
      pricingRepo,
      historyRepo,
      inventoryRepo,
      offerRepo,
      odooSync,
      { record: jest.fn(), log: jest.fn() } as any,
      { invalidate: jest.fn() } as any,
      { transaction: jest.fn(async (cb) => cb(manager)) } as any,
    );
  });

  // ------------------------------------------------------------------
  // The id is enough
  // ------------------------------------------------------------------
  it('updates a grade from its id alone', async () => {
    const res: any = await service.update('admin', 'cond-1', { name_ar: 'ممتازة' });

    expect(res.condition.name_ar).toBe('ممتازة');
  });

  it('deletes a grade from its id alone', async () => {
    conditionRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });

    await service.remove('admin', 'cond-1');

    expect(conditionRepo.delete).toHaveBeenCalledWith('cond-1');
  });

  it('returns the grade WITH the material it belongs to', async () => {
    // The material is the one fact the id does not carry, and the caller almost
    // always needs it next.
    const res: any = await service.getOne('cond-1');

    expect(res.condition.id).toBe('cond-1');
    expect(res.condition.product).toEqual({ id: 'prod-A', name: 'PET' });
  });

  it('reports a grade that does not exist as not found', async () => {
    conditionRepo.findOne.mockResolvedValue(null);

    await expect(service.getOne('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  // ------------------------------------------------------------------
  // The material segment, when given, is ASSERTED
  // ------------------------------------------------------------------
  it('refuses to update through a material the grade does not belong to', async () => {
    await expect(
      service.update('admin', 'cond-1', { name_ar: 'x' }, 'prod-B'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to delete through the wrong material', async () => {
    await expect(
      service.remove('admin', 'cond-1', 'prod-B'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to reorder through the wrong material', async () => {
    await expect(
      service.reorder('admin', 'cond-1', 1, 'prod-B'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows the nested route when the pairing is correct', async () => {
    const res: any = await service.update(
      'admin', 'cond-1', { name_ar: 'ممتازة' }, 'prod-A',
    );

    expect(res.condition.name_ar).toBe('ممتازة');
  });

  // ------------------------------------------------------------------
  // Deletion: stock is the one blocker; price and offers cascade
  // ------------------------------------------------------------------
  it('refuses to delete a grade that still holds stock in any warehouse', async () => {
    productRepo.findOne.mockResolvedValue({ id: 'prod-A', odooProductId: 42 });
    inventoryRepo.createQueryBuilder = jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '5' }),
    }));

    const err = await service.remove('admin', 'cond-1').catch((e) => e);

    expect(String(err.message)).toContain('warehouse stock');
    expect(conditionRepo.delete).not.toHaveBeenCalled();
  });

  it('deletes a grade together with its live price and offers when no stock', async () => {
    productRepo.findOne.mockResolvedValue({ id: 'prod-A', odooProductId: 42 });
    conditionRepo.findOne.mockResolvedValue({ ...CONDITION, odooConditionId: 7 });
    pricingRepo.find.mockResolvedValue([
      { productId: 'prod-A', tier: 'FACTORY', conditionCode: 'PREMIUM', price: '10', currency: 'SYP', effectiveFrom: new Date() },
    ]);

    await service.remove('admin', 'cond-1');

    // Price archived, then removed; offers deleted; grade deleted.
    expect(historyRepo.save).toHaveBeenCalled();
    expect(pricingRepo.remove).toHaveBeenCalled();
    expect(offerRepo.delete).toHaveBeenCalledWith({ conditionId: 'cond-1' });
    expect(conditionRepo.delete).toHaveBeenCalledWith('cond-1');
    // Odoo: price sheet rewritten (drops the row) then the grade unlinked.
    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'prod-A' });
    expect(odooSync.enqueueDeleteCondition).toHaveBeenCalledWith({ odooConditionId: 7 });
  });

  // ------------------------------------------------------------------
  // Adding the FIRST grade drops the conditionless factory/free base price
  // ------------------------------------------------------------------
  const addQb = () =>
    jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ max: '0' }),
      getOne: jest.fn().mockResolvedValue(null), // no name clash
    }));

  it('sweeps out the conditionless factory/free base price when a grade is added', async () => {
    conditionRepo.findOne.mockResolvedValue(null); // no code clash
    conditionRepo.createQueryBuilder = addQb();
    // The material still carries the base (conditionless) price it was given
    // while ungraded — for BOTH graded tiers.
    pricingRepo.find.mockResolvedValue([
      { productId: 'prod-A', tier: 'FACTORY', conditionCode: null, price: '10', currency: 'SYP', effectiveFrom: new Date() },
      { productId: 'prod-A', tier: 'FREE_FACILITY', conditionCode: null, price: '8', currency: 'SYP', effectiveFrom: new Date() },
    ]);
    // …and a conditionless BUYERS offer that discounted that gone base price.
    offerRepo.find.mockResolvedValue([{ id: 'off-1', productId: 'prod-A', conditionId: null, audience: 'BUYERS' }]);

    await service.add('admin', 'prod-A', { code: 'GOOD', name_en: 'Good', name_ar: 'جيدة' });

    // Archived (reason GRADED) then removed…
    expect(historyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ archivedReason: 'GRADED', tier: 'FACTORY' }),
    );
    expect(pricingRepo.remove).toHaveBeenCalled();
    // …the now-baseless conditionless buyers offer is swept out too…
    expect(offerRepo.remove).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'off-1' }),
    ]);
    // …and BOTH Odoo pushes fire: the new grade AND the rewritten price sheet.
    expect(odooSync.enqueueSyncCondition).toHaveBeenCalled();
    expect(odooSync.enqueueUpdatePricing).toHaveBeenCalledWith({ productId: 'prod-A' });
  });

  it('WARNS (without blocking) when the material still holds ungraded stock', async () => {
    conditionRepo.findOne.mockResolvedValue(null);
    conditionRepo.createQueryBuilder = addQb();
    productRepo.findOne.mockResolvedValue({ id: 'prod-A', name: 'PET', odooProductId: 7 });
    // 120 units of ungraded stock across warehouses.
    inventoryRepo.createQueryBuilder = jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '120' }),
    }));

    const res: any = await service.add('admin', 'prod-A', { code: 'GOOD', name_en: 'Good', name_ar: 'جيدة' });

    // The grade is STILL added — the warning does not block it.
    expect(res.condition.code).toBe('GOOD');
    expect(res.warning).toMatch(/ungraded/i);
    expect(res.ungraded_stock_quantity).toBe(120);
  });

  it('adds a grade with NO warning when there is no ungraded stock', async () => {
    conditionRepo.findOne.mockResolvedValue(null);
    conditionRepo.createQueryBuilder = addQb();
    productRepo.findOne.mockResolvedValue({ id: 'prod-A', name: 'PET', odooProductId: 7 });
    inventoryRepo.createQueryBuilder = jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
    }));

    const res: any = await service.add('admin', 'prod-A', { code: 'GOOD', name_en: 'Good', name_ar: 'جيدة' });

    expect(res.condition.code).toBe('GOOD');
    expect(res.warning).toBeUndefined();
    expect(res.ungraded_stock_quantity).toBeUndefined();
  });

  it('leaves Odoo pricing alone when the material had no conditionless base price', async () => {
    conditionRepo.findOne.mockResolvedValue(null);
    conditionRepo.createQueryBuilder = addQb();
    pricingRepo.find.mockResolvedValue([]); // nothing to sweep

    await service.add('admin', 'prod-A', { code: 'GOOD', name_en: 'Good', name_ar: 'جيدة' });

    expect(pricingRepo.remove).not.toHaveBeenCalled();
    expect(odooSync.enqueueUpdatePricing).not.toHaveBeenCalled();
    // The grade itself is still synced.
    expect(odooSync.enqueueSyncCondition).toHaveBeenCalled();
  });

  it('answers a wrong pairing with 400, not 404', async () => {
    // The grade exists and the caller may well be allowed to edit it. What is
    // wrong is the pairing they asked for — saying so is what lets them fix the
    // request instead of hunting a record that is not missing.
    const err = await service
      .update('admin', 'cond-1', { name_ar: 'x' }, 'prod-B')
      .catch((e) => e);

    expect(err.getStatus()).toBe(400);
    expect(String(err.message)).toContain('does not belong');
  });
});
