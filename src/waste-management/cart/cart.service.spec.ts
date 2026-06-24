import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CartService } from './cart.service';
import { Role } from '@src/user/enums/role.enum';
import { UnitType } from '@src/waste-management/enums/unit-type.enum';

/**
 * Unit tests for CartService — per-role limits and tier pricing.
 */
describe('CartService', () => {
  let service: CartService;
  let cartRepo: any;
  let itemRepo: any;
  let productRepo: any;
  let pricingRepo: any;
  let offerRepo: any;
  let priceQb: any;

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
    productRepo = { findOne: jest.fn().mockResolvedValue({ id: 'p1', isActive: true }) };
    pricingRepo = { createQueryBuilder: jest.fn().mockReturnValue(priceQb) };
    offerRepo = { createQueryBuilder: jest.fn(), findOne: jest.fn() };

    service = new CartService(cartRepo, itemRepo, productRepo, pricingRepo, offerRepo);
  });

  it('adds a product priced at the buyer tier and returns a summary', async () => {
    itemRepo.find.mockResolvedValueOnce([{ quantity: '5', subtotal: '1.5', unitType: UnitType.KG }]);

    const res = await service.addItem(citizen, {
      product_id: 'p1',
      quantity: 5,
      unit_type: UnitType.KG,
    });

    expect(res.cart_id).toBe('cart1');
    expect(res.item_id).toBe('item1');
    expect(res.cart_summary.total_price).toBe(1.5);
    expect(res.cart_summary.min_required).toBe(1); // citizen minimum
    expect(res.cart_summary.max_allowed).toBe(100); // citizen daily cap
    expect(res.cart_summary.can_proceed_to_checkout).toBe(true);
  });

  it('rejects when a citizen exceeds the daily unit cap', async () => {
    cartRepo.findOne.mockResolvedValue({ id: 'cart1', accountId: 'u1' });
    itemRepo.find.mockResolvedValueOnce([{ quantity: '98' }]); // already 98 today

    await expect(
      service.addItem(citizen, { product_id: 'p1', quantity: 5, unit_type: UnitType.KG }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFound when the product is missing or inactive', async () => {
    productRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.addItem(citizen, { product_id: 'x', quantity: 1, unit_type: UnitType.KG }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('has no daily cap for companies (dailyMax = null)', async () => {
    const company = { id: 'c1', role: Role.INSTITUTIONS };
    itemRepo.find.mockResolvedValueOnce([{ quantity: '500', subtotal: '150', unitType: UnitType.KG }]);

    const res = await service.addItem(company, {
      product_id: 'p1',
      quantity: 500,
      unit_type: UnitType.KG,
    });

    expect(res.cart_summary.max_allowed).toBeNull();
    expect(res.cart_summary.min_required).toBe(10); // company minimum
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
