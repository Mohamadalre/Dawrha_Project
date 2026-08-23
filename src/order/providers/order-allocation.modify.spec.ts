import { OrderAllocationService } from './order-allocation.service';
import { OrderPartStatus } from '../enums/order-part-status.enum';
import { OrderStatus } from '../enums/order-status.enum';

/** Chainable stub for the stock-holding-warehouse query in buildSupplies. */
const stockQb = (warehouseIds: string[]) => ({
  innerJoin: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue(warehouseIds.map((id) => ({ warehouseId: id }))),
});

/**
 * The alternatives an admin is shown when they MODIFY a split.
 *
 * Same number of warehouses as the split itself, every set that covers the whole
 * order, nearest first, the current set excluded, and never a warehouse that
 * holds none of the order.
 */
describe('OrderAllocationService.modificationOptions', () => {
  const line = (qty: string) => ({
    productId: 'p',
    odooProductId: 42,
    conditionCode: 'GOOD',
    productName: 'PET',
    quantity: qty,
    unitType: 'KG',
    unitPrice: '1',
  });

  const build = () => {
    const orderRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: '00000000-0000-0000-0000-0000000000d1',
        orderNumber: 'ORD-1',
        buyerProfileId: 'buyer1',
        provinceId: 'prov1',
      }),
    };
    // The order is split across a and b (40 + 40 = 80 of PET:GOOD).
    const partRepo = {
      find: jest.fn().mockResolvedValue([
        { warehouseId: 'a', status: OrderPartStatus.IN_OUTPUT_ZONE, lines: [line('40')] },
        { warehouseId: 'b', status: OrderPartStatus.IN_OUTPUT_ZONE, lines: [line('40')] },
      ]),
    };
    const offerRepo = { find: jest.fn().mockResolvedValue([]) }; // none disqualified
    // a, b, c all stock PET:GOOD; c also covers alone but pairs are what's asked.
    const inventoryRepo = {
      find: jest.fn().mockResolvedValue([
        { warehouseId: 'a', odooProductId: 42, conditionCode: 'GOOD', quantity: '40', reservedQuantity: '0' },
        { warehouseId: 'b', odooProductId: 42, conditionCode: 'GOOD', quantity: '40', reservedQuantity: '0' },
        { warehouseId: 'c', odooProductId: 42, conditionCode: 'GOOD', quantity: '60', reservedQuantity: '0' },
      ]),
      createQueryBuilder: jest.fn(() => stockQb(['a', 'b', 'c'])),
    };
    const warehouseRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'a', name: 'A', odooWarehouseId: 1 },
        { id: 'b', name: 'B', odooWarehouseId: 2 },
        { id: 'c', name: 'C', odooWarehouseId: 3 },
      ]),
    };
    const distance = {
      rankWarehouses: jest.fn().mockResolvedValue([
        { warehouseId: 'a', distanceKm: 2 },
        { warehouseId: 'b', distanceKm: 4 },
        { warehouseId: 'c', distanceKm: 6 },
      ]),
    };

    const svc = new OrderAllocationService(
      orderRepo as any, partRepo as any, {} as any, offerRepo as any,
      inventoryRepo as any, warehouseRepo as any, distance as any, {} as any, {} as any,
    );
    return { svc };
  };

  it('offers every OTHER covering pair, nearest first, excluding the current set', async () => {
    const { svc } = build();
    const res: any = await svc.modificationOptions('00000000-0000-0000-0000-0000000000d1');

    expect(res.split_size).toBe(2);
    expect(res.current.map((w: any) => w.id).sort()).toEqual(['a', 'b']);

    // Pairs covering 80: {a,b}=current (excluded), {a,c}=8km, {b,c}=10km.
    expect(res.options).toHaveLength(2);
    expect(res.options[0].warehouses.map((w: any) => w.id).sort()).toEqual(['a', 'c']);
    expect(res.options[0].total_distance_km).toBe(8);
    expect(res.options[1].warehouses.map((w: any) => w.id).sort()).toEqual(['b', 'c']);
    // Every option is the SAME size as the split; the current set never appears.
    expect(res.options.every((o: any) => o.warehouses.length === 2)).toBe(true);
    expect(res.options[0].warehouses[0]).toHaveProperty('name');
  });

  it('returns no options for a single-warehouse (unsplit) order', async () => {
    const { svc } = build();
    // Override: the order sits in one warehouse only.
    (svc as any).partRepo.find.mockResolvedValue([
      { warehouseId: 'a', status: OrderPartStatus.IN_OUTPUT_ZONE, lines: [line('80')] },
    ]);

    const res: any = await svc.modificationOptions('00000000-0000-0000-0000-0000000000d1');
    expect(res.is_split).toBe(false);
    expect(res.options).toEqual([]);
  });
});

describe('OrderAllocationService.applyModification', () => {
  const line = (qty: string) => ({
    productId: 'p',
    odooProductId: 42,
    conditionCode: 'GOOD',
    productName: 'PET',
    quantity: qty,
    unitType: 'KG',
    unitPrice: '1',
  });

  const buildApply = () => {
    // The split, awaiting approval, on a and b. References so status mutations
    // persist across the save/read the method does.
    const livePartA = { id: 'pa', orderId: '00000000-0000-0000-0000-0000000000d1', warehouseId: 'a', status: 'OFFERED', stockReserved: true, lines: [line('40')] };
    const livePartB = { id: 'pb', orderId: '00000000-0000-0000-0000-0000000000d1', warehouseId: 'b', status: 'OFFERED', stockReserved: true, lines: [line('40')] };
    const liveParts = [livePartA, livePartB];
    const createdParts: any[] = [];

    const orderRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: '00000000-0000-0000-0000-0000000000d1',
        orderNumber: 'ORD-1',
        buyerProfileId: 'buyer1',
        provinceId: 'prov1',
        status: OrderStatus.AWAITING_APPROVAL,
        fulfilmentMode: 'PICKUP',
        allocationRound: 0,
      }),
      save: jest.fn(async (o: any) => o),
    };
    const partRepo = {
      find: jest.fn(async () => liveParts),
      count: jest.fn(async () => liveParts.length),
      save: jest.fn(async (p: any) => {
        if (!p.id) { p.id = `new-${createdParts.length}`; createdParts.push(p); }
        return p;
      }),
      create: jest.fn((x: any) => x),
    };
    const offerRepo = {
      find: jest.fn().mockResolvedValue([]), // none disqualified
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn(async (x: any) => x),
      create: jest.fn((x: any) => x),
    };
    const lineRepo = { save: jest.fn(async (x: any) => x), create: jest.fn((x: any) => x) };
    const inventoryRepo = {
      find: jest.fn().mockResolvedValue([
        { warehouseId: 'a', odooProductId: 42, conditionCode: 'GOOD', quantity: '40', reservedQuantity: '0' },
        { warehouseId: 'b', odooProductId: 42, conditionCode: 'GOOD', quantity: '40', reservedQuantity: '0' },
        { warehouseId: 'c', odooProductId: 42, conditionCode: 'GOOD', quantity: '60', reservedQuantity: '0' },
      ]),
      createQueryBuilder: jest.fn(() => stockQb(['a', 'b', 'c'])),
    };
    const warehouseRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'a', name: 'A', odooWarehouseId: 1 },
        { id: 'c', name: 'C', odooWarehouseId: 3 },
      ]),
    };
    const distance = {
      rankWarehouses: jest.fn().mockResolvedValue([
        { warehouseId: 'a', distanceKm: 2 },
        { warehouseId: 'b', distanceKm: 4 },
        { warehouseId: 'c', distanceKm: 6 },
      ]),
    };
    const odooSync = { enqueueCancelOrderPart: jest.fn(), enqueuePushOrderPart: jest.fn() };

    const svc = new OrderAllocationService(
      orderRepo as any, partRepo as any, lineRepo as any, offerRepo as any,
      inventoryRepo as any, warehouseRepo as any, distance as any, {} as any, odooSync as any,
    );
    return { svc, orderRepo, offerRepo, odooSync, liveParts, createdParts };
  };

  it('re-routes onto the chosen set: cancels the old parts, offers the new ones', async () => {
    const { svc, orderRepo, offerRepo, odooSync, liveParts, createdParts } = buildApply();

    const res: any = await svc.applyModification('00000000-0000-0000-0000-0000000000d1', ['a', 'c'], 'admin-9');

    // The old parts were cancelled and their reservations released in Odoo.
    expect(liveParts.every((p) => p.status === 'CANCELLED')).toBe(true);
    expect(offerRepo.update).toHaveBeenCalled(); // offers withdrawn
    expect(odooSync.enqueueCancelOrderPart).toHaveBeenCalledTimes(2);

    // Fresh parts were offered to a and c (40 each), and pushed to Odoo.
    expect(createdParts.map((p) => p.warehouseId).sort()).toEqual(['a', 'c']);
    expect(odooSync.enqueuePushOrderPart).toHaveBeenCalledTimes(2);

    // A new allocation round, still awaiting approval.
    expect(orderRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: OrderStatus.AWAITING_APPROVAL, allocationRound: 1 }),
    );
    expect(res.parts).toBe(2);
  });

  it('refuses to modify an order that is no longer awaiting approval', async () => {
    const { svc, orderRepo } = buildApply();
    orderRepo.findOne.mockResolvedValue({
      id: '00000000-0000-0000-0000-0000000000d1', orderNumber: 'ORD-1', status: OrderStatus.PREPARING,
      fulfilmentMode: 'PICKUP', allocationRound: 1,
    });
    await expect(svc.applyModification('00000000-0000-0000-0000-0000000000d1', ['a', 'c'])).rejects.toThrow();
  });

  it('refuses a chosen set of the wrong size', async () => {
    const { svc } = buildApply();
    await expect(svc.applyModification('00000000-0000-0000-0000-0000000000d1', ['a'])).rejects.toThrow();
  });
});
