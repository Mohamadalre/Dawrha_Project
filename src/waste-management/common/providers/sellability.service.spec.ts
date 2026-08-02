import { BadRequestException } from '@nestjs/common';
import { SellabilityService } from './sellability.service';
import { PricingTier } from '../../enums/pricing-tier.enum';

/**
 * The rule these tests hold the system to:
 *
 *   a material with no LIVE price for a buyer's tier does not exist for that
 *   buyer — not in the listing, not in the basket, not in an order.
 *
 * Anything less means the buyer meets the failure at checkout, on a line that
 * could never have been priced.
 */
describe('SellabilityService', () => {
  const PET = 'product-pet';
  const ALU = 'product-alu';

  let rows: any[];
  let service: SellabilityService;

  const build = () => {
    const pricingRepo: any = {
      createQueryBuilder: () => {
        let tier: PricingTier | undefined;
        const qb: any = {
          where: () => qb,
          andWhere: (_sql: string, params?: any) => {
            if (params?.tier) tier = params.tier;
            return qb;
          },
          select: () => qb,
          getMany: async () => rows.filter((r) => r.tier === tier),
          getRawMany: async () =>
            [...new Set(rows.map((r) => r.productId))].map((productId) => ({
              productId,
            })),
        };
        return qb;
      },
    };
    return new SellabilityService(pricingRepo);
  };

  beforeEach(() => {
    rows = [
      // PET is priced for factories only.
      { productId: PET, tier: PricingTier.FACTORY, conditionCode: 'GOOD', price: '12' },
      { productId: PET, tier: PricingTier.FACTORY, conditionCode: 'POOR', price: '7' },
      // ALU is priced for citizens only, and is ungraded.
      { productId: ALU, tier: PricingTier.INDIVIDUAL, conditionCode: null, price: '3' },
    ];
    service = build();
  });

  it('shows a material only to the tier it is priced for', async () => {
    const forFactory = await service.sellableIds([PET, ALU], PricingTier.FACTORY);
    const forCitizen = await service.sellableIds([PET, ALU], PricingTier.INDIVIDUAL);

    expect(forFactory.has(PET)).toBe(true);
    // A citizen must not see a material priced only for factories.
    expect(forFactory.has(ALU)).toBe(false);
    expect(forCitizen.has(ALU)).toBe(true);
    expect(forCitizen.has(PET)).toBe(false);
  });

  it('gives each tier ITS OWN price, never another tier\'s', async () => {
    expect(await service.priceFor(PET, PricingTier.FACTORY, 'GOOD')).toBe(12);
    expect(await service.priceFor(PET, PricingTier.FACTORY, 'POOR')).toBe(7);
    // The same material, a tier it is not priced for → nothing to charge.
    expect(await service.priceFor(PET, PricingTier.INDIVIDUAL, 'GOOD')).toBeNull();
  });

  it('treats an unpriced GRADE as unbuyable as an unpriced material', async () => {
    // A grade added after the price list was set has no price of its own, and
    // there is no number to charge for it.
    expect(await service.priceFor(PET, PricingTier.FACTORY, 'EXCELLENT')).toBeNull();
  });

  it('prices an ungraded material with no condition at all', async () => {
    expect(await service.priceFor(ALU, PricingTier.INDIVIDUAL, null)).toBe(3);
  });

  it('refuses BY NAME when a buyer reaches for something they cannot buy', async () => {
    // This is the checkout guard: a basket left open while the admin withdrew
    // the price list must fail here, clearly, not deep inside order creation.
    await expect(
      service.assertSellable(PET, 'PET bottles', PricingTier.INDIVIDUAL),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.assertSellable(PET, 'PET bottles', PricingTier.INDIVIDUAL),
    ).rejects.toThrow(/PET bottles/);
  });

  it('lets a purchase through when the price is live', async () => {
    await expect(
      service.assertSellable(PET, 'PET bottles', PricingTier.FACTORY, 'GOOD'),
    ).resolves.toBe(12);
  });

  it('reports a material whose whole price list was withdrawn', async () => {
    rows = [];
    service = build();
    const unpriced = await service.unpricedProducts([PET, ALU]);
    expect(unpriced.has(PET)).toBe(true);
    expect(unpriced.has(ALU)).toBe(true);
  });

  it('answers nothing for an empty request instead of querying', async () => {
    expect((await service.sellableIds([], PricingTier.FACTORY)).size).toBe(0);
    expect((await service.unpricedProducts([])).size).toBe(0);
  });
});
