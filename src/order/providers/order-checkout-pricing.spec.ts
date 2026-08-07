import { BadRequestException } from '@nestjs/common';
import { OrderCheckoutService } from './order-checkout.service';
import { Role } from '@src/user/enums/role.enum';

/**
 * What a placed order line is CHARGED — the step that takes money.
 *
 * This is where the offer used to be lost. Checkout re-read the plain list
 * price from `assertSellable` and wrote that onto the order line, so a buyer
 * who had been shown an offer everywhere else was invoiced the full amount.
 * Every other screen was right; the invoice was not.
 *
 * The line is now priced through `EffectivePriceService`, and it is read FRESH
 * here rather than trusted from the basket: an offer can end while a basket
 * sits open, so what is charged has to be what is true at the moment the order
 * is placed — after which the line is a snapshot nothing may move.
 *
 * `toRequestedLines` is private because it is one internal step of checkout;
 * it is driven directly here because it is the exact place the money is
 * decided, and a test that went through the whole checkout would need a
 * warehouse, stock and allocation to reach it.
 */
describe('checkout prices each line at the effective (offer) price', () => {
  const PRODUCT = 'prod-1';

  const build = (opts: {
    base: number;
    effective: { basePrice: number; offer: any; price: number } | null;
  }) => {
    const productRepo = {
      find: jest.fn(async () => [
        { id: PRODUCT, name: 'PET', odooProductId: 42 },
      ]),
    };
    const sellability = {
      // Still consulted: it is the guard that refuses a material whose price
      // list was withdrawn while it sat in the basket.
      assertSellable: jest.fn(async () => opts.base),
    };
    const effectivePrice = {
      effectivePrice: jest.fn(async () => opts.effective),
    };

    const svc = new OrderCheckoutService(
      {} as any, {} as any, {} as any, {} as any, {} as any,
      productRepo as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, sellability as any, effectivePrice as any, {} as any,
    );
    return { svc, productRepo, sellability, effectivePrice };
  };

  const cartItem = (over: any = {}) => ({
    productId: PRODUCT,
    conditionCode: null,
    quantity: '4',
    unitType: 'KG',
    ...over,
  });

  const lines = (svc: OrderCheckoutService, items: any[], role: Role) =>
    (svc as any).toRequestedLines(items, role) as Promise<any[]>;

  it('charges the offer price, not the list price', async () => {
    // List 10, live buyer offer takes 3 off → the line must be 7. Charging 10
    // here is the exact bug this guards.
    const { svc } = build({
      base: 10,
      effective: { basePrice: 10, offer: { id: 'o1' }, price: 7 },
    });

    const [line] = await lines(svc, [cartItem()], Role.FACTORY);

    expect(line.unitPrice).toBe(7);
  });

  it('re-reads FRESH, so an offer that ended charges the list price', async () => {
    // The basket may have quoted 7 when the offer was live; if it ended before
    // checkout the effective price is the list 10 again, and that is what the
    // order must hold — not the stale 7.
    const { svc } = build({
      base: 10,
      effective: { basePrice: 10, offer: null, price: 10 },
    });

    const [line] = await lines(svc, [cartItem()], Role.FACTORY);

    expect(line.unitPrice).toBe(10);
  });

  it('still refuses a material whose price list was withdrawn', async () => {
    // assertSellable throws by name — the effective-price step never runs, and
    // the order is refused rather than priced at nothing.
    const { svc, sellability, effectivePrice } = build({
      base: 10,
      effective: null,
    });
    sellability.assertSellable.mockRejectedValueOnce(
      new BadRequestException('"PET" is not available for purchase at the moment'),
    );

    await expect(lines(svc, [cartItem()], Role.FACTORY)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(effectivePrice.effectivePrice).not.toHaveBeenCalled();
  });

  it('prices against the buyer’s role and the line’s grade', async () => {
    const { svc, effectivePrice } = build({
      base: 10,
      effective: { basePrice: 10, offer: null, price: 10 },
    });

    await lines(svc, [cartItem({ conditionCode: 'GOOD' })], Role.EXTERNAL_PARTNER);

    expect(effectivePrice.effectivePrice).toHaveBeenCalledWith(
      PRODUCT,
      Role.EXTERNAL_PARTNER,
      'GOOD',
    );
  });
});
