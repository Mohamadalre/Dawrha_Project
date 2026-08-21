import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CartService } from './cart.service';
import { Role } from '@src/user/enums/role.enum';


/**
 * Unit tests for CartService — per-role limits and tier pricing.
 */
describe('CartService', () => {
  let service: CartService;
  let cartRepo: any;
  let itemRepo: any;
  let productRepo: any;
  let units: any;
  let conditionsService: any;
  let priceQb: any;
  let effectivePriceService: any;

  const citizen = { id: 'u1', role: Role.CITIZEN };

  beforeEach(() => {
    priceQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ price: '0.30' }),
    };

    cartRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x) => x),
      save: jest.fn().mockResolvedValue({ id: 'cart1', accountId: 'u1' }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    itemRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((x) => ({ id: 'item1', ...x })),
      save: jest.fn((x) => Promise.resolve(x)),
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    // The material carries its own unit now — the cart reads product.unitType
    // instead of taking a unit from the request.
    productRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'p1', isActive: true, unitType: 'KG', odooProductId: 1 }),
    };
    units = {
      weightCodes: jest.fn(async () => new Set(['KG'])),
    };
    // Grades are resolved against the MATERIAL, BY ID. hasConditions gates
    // whether a grade is asked for at all.
    conditionsService = {
      hasConditions: jest.fn(async () => false),
      resolveActiveById: jest.fn(async (_p: string, id: string) => ({
        id,
        code: 'GRADE_' + id.toUpperCase(),
      })),
      gradeMapFor: jest.fn(async () => new Map()),
    };

    // Answers from the SAME price mock the rest of this file drives, so the
    // existing expectations still measure the tier price the cart charges.
    // No offer unless a test says otherwise — `offer: null` is the ordinary
    // case, and the sign of an offer is exercised in offer-audience.spec.ts
    // rather than duplicated here.
    effectivePriceService = {
      effectivePrice: jest.fn(async () => {
        const row = await priceQb.getOne();
        return row ? { price: Number(row.price), offer: null } : null;
      }),
    };

    // The stock guard runs only for factories / free facilities; the citizen
    // tests here never reach it, so a permissive stub is enough.
    const inventoryRepo: any = {
      createQueryBuilder: jest.fn(() => ({
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn(async () => ({ available: '1000000' })),
      })),
    };
    const buyerProfiles: any = { provinceForBuyer: jest.fn(async () => 'prov1') };

    service = new CartService(
      cartRepo, itemRepo, productRepo, units,
      conditionsService, effectivePriceService,
      inventoryRepo, buyerProfiles,
    );
  });

  it('adds a product priced at the buyer tier and returns a summary', async () => {
    itemRepo.find.mockResolvedValueOnce([{ quantity: '5', subtotal: '1.5', unitType: 'KG' }]);

    const res = await service.addItem(citizen, {
      product_id: 'p1',
      quantity: 5,
    });

    expect(res.cart_id).toBe('cart1');
    expect(res.item_id).toBe('item1');
    expect(res.cart_summary.total_price).toBe(1.5);
    // The unit is the material's own, and no offer means the list price.
    expect(res.item.unit_type).toBe('KG');
    expect(res.item.unit_price).toBe(0.3);
    expect(res.item.has_offer).toBe(false);
    expect(res.item).not.toHaveProperty('offer');
    expect(res.cart_summary.can_proceed_to_checkout).toBe(true);
  });

  it('takes the offer price and flags the line when an offer targets the role', async () => {
    // effectivePrice already applies the role- and grade-scoped offer; the cart
    // just surfaces it. price 0.20 instead of the 0.30 list.
    effectivePriceService.effectivePrice.mockResolvedValueOnce({
      price: 0.2,
      offer: { id: 'off1' },
    });

    const res = await service.addItem(citizen, { product_id: 'p1', quantity: 10 });

    expect(res.item.has_offer).toBe(true);
    expect(res.item.offer.id).toBe('off1');
    expect(res.item.unit_price).toBe(0.2);
    const savedLine = itemRepo.save.mock.calls[0][0];
    expect(savedLine.offerId).toBe('off1');
    expect(savedLine.isOffer).toBe(true);
  });

  it('throws NotFound when the product is missing or inactive', async () => {
    productRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.addItem(citizen, { product_id: 'x', quantity: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('derives the unit from the material, not the request', async () => {
    productRepo.findOne.mockResolvedValueOnce({ id: 'p2', isActive: true, unitType: 'TON' });
    await service.addItem(citizen, { product_id: 'p2', quantity: 2 });
    const savedLine = itemRepo.save.mock.calls[0][0];
    expect(savedLine.unitType).toBe('TON');
  });

  describe('grade requirement by role', () => {
    it('refuses a FACTORY adding a graded material with no condition_id', async () => {
      conditionsService.hasConditions.mockResolvedValueOnce(true);

      await expect(
        service.addItem(
          { id: 'f1', role: Role.FACTORY },
          { product_id: 'p1', quantity: 5 } as any,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      // A missing grade is caught BEFORE the id is ever resolved.
      expect(conditionsService.resolveActiveById).not.toHaveBeenCalled();
    });

    it('does not ask a FACTORY for a grade on an ungraded material', async () => {
      conditionsService.hasConditions.mockResolvedValueOnce(false);
      const res = await service.addItem(
        { id: 'f1', role: Role.FACTORY },
        { product_id: 'p1', quantity: 5 } as any,
      );
      expect(conditionsService.resolveActiveById).not.toHaveBeenCalled();
      const savedLine = itemRepo.save.mock.calls[0][0];
      expect(savedLine.conditionCode).toBeNull();
      expect(res.item_id).toBe('item1');
    });

    it('lets a CITIZEN add a graded material WITHOUT a grade (priced flat)', async () => {
      // Citizens are priced flat: the grade is never asked for, and a sent
      // condition_id is ignored so it can never pull them off the flat price.
      conditionsService.hasConditions.mockResolvedValueOnce(true);
      const res = await service.addItem(citizen, {
        product_id: 'p1', quantity: 5, condition_id: 'cond-uuid',
      } as any);

      expect(conditionsService.resolveActiveById).not.toHaveBeenCalled();
      const savedLine = itemRepo.save.mock.calls[0][0];
      expect(savedLine.conditionCode).toBeNull();
      expect(res.item_id).toBe('item1');
    });

    it('resolves the grade BY ID for a FACTORY on a graded material', async () => {
      conditionsService.hasConditions.mockResolvedValueOnce(true);
      conditionsService.resolveActiveById.mockResolvedValueOnce({ id: 'cond-uuid', code: 'GOOD' });

      await service.addItem(
        { id: 'f1', role: Role.FACTORY },
        { product_id: 'p1', quantity: 5, condition_id: 'cond-uuid' } as any,
      );

      expect(conditionsService.resolveActiveById).toHaveBeenCalledWith('p1', 'cond-uuid');
      const savedLine = itemRepo.save.mock.calls[0][0];
      // The code comes from the RESOLVED row, not from the request.
      expect(savedLine.conditionCode).toBe('GOOD');
      // effectivePrice is asked for that exact grade.
      expect(effectivePriceService.effectivePrice).toHaveBeenCalledWith('p1', Role.FACTORY, 'GOOD');
    });
  });

  describe('duplicate lines', () => {
    const { ConflictException } = require('@nestjs/common');

    it('refuses a flat buyer re-adding the same material — edit instead', async () => {
      cartRepo.findOne.mockResolvedValue({ id: 'cart1', accountId: 'u1' });
      itemRepo.findOne.mockResolvedValueOnce({ id: 'existing', productId: 'p1' });

      await expect(
        service.addItem(citizen, { product_id: 'p1', quantity: 5 } as any),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(itemRepo.save).not.toHaveBeenCalled();
    });

    it('refuses a FACTORY re-adding the same material+grade', async () => {
      conditionsService.hasConditions.mockResolvedValueOnce(true);
      conditionsService.resolveActiveById.mockResolvedValueOnce({ id: 'c1', code: 'GOOD' });
      itemRepo.findOne.mockResolvedValueOnce({ id: 'existing', productId: 'p1', conditionCode: 'GOOD' });

      await expect(
        service.addItem(
          { id: 'f1', role: Role.FACTORY },
          { product_id: 'p1', quantity: 5, condition_id: 'c1' } as any,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('lets a FACTORY add the same material with a DIFFERENT grade', async () => {
      conditionsService.hasConditions.mockResolvedValueOnce(true);
      conditionsService.resolveActiveById.mockResolvedValueOnce({ id: 'c2', code: 'FAIR' });
      // No existing line for (p1, FAIR) → allowed.
      itemRepo.findOne.mockResolvedValueOnce(null);

      const res = await service.addItem(
        { id: 'f1', role: Role.FACTORY },
        { product_id: 'p1', quantity: 5, condition_id: 'c2' } as any,
      );
      expect(res.item_id).toBe('item1');
      expect(itemRepo.save).toHaveBeenCalled();
    });
  });

  describe('clearCart', () => {
    it('deletes the cart when one exists', async () => {
      cartRepo.findOne.mockResolvedValueOnce({ id: 'cart1', accountId: 'u1' });
      const res = await service.clearCart(citizen);
      expect(cartRepo.delete).toHaveBeenCalledWith('cart1');
      expect(res.message).toBe('Cart cleared successfully');
    });

    it('is a no-op when the cart is already empty', async () => {
      cartRepo.findOne.mockResolvedValueOnce(null);
      const res = await service.clearCart(citizen);
      expect(cartRepo.delete).not.toHaveBeenCalled();
      expect(res.message).toBe('Cart is already empty');
    });
  });
});
