import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { DeliveryRateService } from '@src/warehouse/providers/delivery-rate.service';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { Order } from '../entities/order.entity';
import { OrderPart } from '../entities/order-part.entity';
import { OrderPartLine } from '../entities/order-part-line.entity';
import { OrderPartOffer } from '../entities/order-part-offer.entity';
import { OrderStatus } from '../enums/order-status.enum';
import {
  FAILED_PART_STATUSES,
  OrderPartStatus,
} from '../enums/order-part-status.enum';
import {
  DISQUALIFYING_OFFER_STATUSES,
  OrderOfferStatus,
} from '../enums/order-offer-status.enum';
import { FulfilmentMode } from '../enums/fulfilment-mode.enum';
import {
  MAX_ALLOCATION_ROUNDS,
  OFFER_EXPIRY_HOURS,
  PARTIAL_FULFILMENT_TOLERANCE,
} from '../order.config';
import {
  RequiredLine,
  WarehouseSupply,
  coveringCombinations,
  planAllocation,
  planForWarehouses,
  shortfallRatio,
} from './allocation-planner';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { WarehouseState } from '@src/warehouse/enums/warehouse-state.enum';
import { DistanceService } from './distance.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

const LOG_META = { context: 'ORDER_ALLOCATION', channel: 'orders' } as const;

/** What a buyer asked for, in the shape both the planner and Odoo speak. */
export interface RequestedLine {
  productId: string;
  odooProductId: number;
  productName: string;
  conditionCode: string | null;
  quantity: number;
  unitType: string;
  unitPrice: number;
}

export type AllocationOutcome =
  | { result: 'ALLOCATED'; parts: number }
  | { result: 'PARTIAL_NEEDS_BUYER'; missingRatio: number }
  | { result: 'EXHAUSTED' }
  | { result: 'NO_STOCK' };

/**
 * A plain sentence for an allocation outcome, so a response carries a message a
 * person can read — not the raw code (`PARTIAL_NEEDS_BUYER`, `NO_STOCK`) that
 * only the client's own logic understands. The code still travels beside it for
 * that logic; this is the part the buyer is shown.
 */
export function describeAllocation(outcome: AllocationOutcome): string {
  switch (outcome.result) {
    case 'ALLOCATED':
      return outcome.parts > 0
        ? 'Your order was placed and sent to the warehouse(s) for approval.'
        : 'Your order was placed and is being processed.';
    case 'PARTIAL_NEEDS_BUYER':
      return 'Only part of your order is available in your governorate right now — review the available quantity and choose whether to go ahead or cancel.';
    case 'NO_STOCK':
      return 'The items you ordered are currently out of stock in the warehouses that serve your governorate.';
    case 'EXHAUSTED':
      return 'Your order could not be arranged automatically after several attempts — an administrator will review it.';
    default:
      return 'Your order was received.';
  }
}

/**
 * Turns a placed order into work for warehouses.
 *
 * Everything hard about the decision lives in `planAllocation`, which is pure
 * and separately tested. This service only does the parts that need the world:
 * reading stock, writing parts and offers, and pushing them to Odoo.
 *
 * Reallocation after a rejection re-enters here. It terminates for three
 * independent reasons, and all three are needed:
 *   - a warehouse that already refused is excluded (the offer ledger),
 *   - the round counter is capped,
 *   - an unanswered offer expires instead of waiting forever.
 */
@Injectable()
export class OrderAllocationService {
  constructor(
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderPart) private readonly partRepo: Repository<OrderPart>,
    @InjectRepository(OrderPartLine)
    private readonly lineRepo: Repository<OrderPartLine>,
    @InjectRepository(OrderPartOffer)
    private readonly offerRepo: Repository<OrderPartOffer>,
    @InjectRepository(WarehouseInventory)
    private readonly inventoryRepo: Repository<WarehouseInventory>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    private readonly distance: DistanceService,
    private readonly rates: DeliveryRateService,
    private readonly odooSync: OdooSyncService,
  ) {}

  /**
   * Allocates (or re-allocates) an order.
   *
   * `requested` is given on the first pass, when the lines come from the cart.
   * On a re-run it is left out and the lines are taken from the parts that
   * failed — the accepted parts keep theirs, so only the unserved remainder is
   * looked for again.
   */
  async allocate(
    orderId: string,
    requested?: RequestedLine[],
    options?: { forcePartial?: boolean },
  ): Promise<AllocationOutcome> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) return { result: 'NO_STOCK' };

    if (order.allocationRound >= MAX_ALLOCATION_ROUNDS) {
      await this.markExhausted(order);
      return { result: 'EXHAUSTED' };
    }

    const lines = requested ?? (await this.linesFromFailedParts(orderId));
    if (!lines.length) return { result: 'ALLOCATED', parts: 0 };

    const supplies = await this.buildSupplies(order, lines);
    if (!supplies.length) {
      await this.markExhausted(order);
      return { result: 'NO_STOCK' };
    }

    const required: RequiredLine[] = lines.map((l) => ({
      key: lineKey(l.odooProductId, l.conditionCode),
      quantity: l.quantity,
    }));
    const plan = planAllocation({
      required,
      supplies,
      mode: order.fulfilmentMode,
    });

    if (!plan.parts.length) {
      await this.markExhausted(order);
      return { result: 'NO_STOCK' };
    }

    // A shortfall the buyer did not pre-agree to is theirs to decide, not ours
    // to ship quietly — unless they are answering that very question now
    // (`forcePartial`), having been shown exactly what is available.
    const missing = shortfallRatio(plan, required);
    const withinTolerance = missing <= PARTIAL_FULFILMENT_TOLERANCE;
    const forcePartial = options?.forcePartial === true;
    if (
      !plan.fullyCovered &&
      !forcePartial &&
      !(order.acceptPartialFulfilment && withinTolerance)
    ) {
      order.status = OrderStatus.NEEDS_CUSTOMER_DECISION;
      // Freeze the request: the cart is emptied and no parts exist yet, so this
      // snapshot is the only place the decision endpoint can re-plan from.
      order.requestedLines = lines;
      await this.orderRepo.save(order);
      return { result: 'PARTIAL_NEEDS_BUYER', missingRatio: missing };
    }

    if (plan.parts.length > 1) {
      order.status = OrderStatus.AWAITING_SPLIT_APPROVAL;
      order.requestedLines = lines;
      await this.orderRepo.save(order);
      winstonLogger.info(
        `Order ${order.orderNumber}: split across ${plan.parts.length} warehouse(s) — awaiting warehouses-manager approval`,
        LOG_META,
      );
      return { result: 'ALLOCATED', parts: plan.parts.length };
    }

    // Allocation is proceeding, so the pending-decision snapshot is spent.
    order.requestedLines = null;
    const round = order.allocationRound + 1;
    const byKey = new Map(lines.map((l) => [lineKey(l.odooProductId, l.conditionCode), l]));
    const existingParts = await this.partRepo.count({ where: { orderId } });

    let sequence = existingParts;
    for (const planned of plan.parts) {
      sequence += 1;
      await this.createPart(order, planned, byKey, sequence, round);
    }

    order.allocationRound = round;
    order.status = OrderStatus.AWAITING_APPROVAL;
    await this.recalculateTotals(order);
    winstonLogger.info(
      `Order ${order.orderNumber}: round ${round} allocated to ${plan.parts.length} warehouse(s)`,
      LOG_META,
    );
    return { result: 'ALLOCATED', parts: plan.parts.length };
  }

  /**
   * The alternative warehouse sets an ADMIN may swap a SPLIT order to when they
   * choose to modify it.
   *
   * Returns every set of the SAME number of warehouses as the split itself that
   * together cover the whole order — never a different size — nearest (least
   * total distance) first, with the current set excluded and any warehouse that
   * holds none of the ordered materials dropped. The admin picks one; applying
   * it is a re-allocation onto exactly those warehouses.
   */
  async modificationOptions(orderId: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status === OrderStatus.AWAITING_SPLIT_APPROVAL) {
      const requested = (order.requestedLines ?? []) as RequestedLine[];
      if (!requested.length) throw new NotFoundException('No pending split found');
      const required: RequiredLine[] = requested.map((l) => ({
        key: lineKey(l.odooProductId, l.conditionCode),
        quantity: l.quantity,
      }));
      const supplies = await this.buildSupplies(order, requested);
      const plan = planAllocation({ required, supplies, mode: order.fulfilmentMode });
      const currentWarehouses = plan.parts.map((p) => p.warehouseId);
      const size = currentWarehouses.length;
      const base = {
        order_id: orderId,
        order_number: order.orderNumber,
        split_size: size,
        is_split: size > 1,
      };
      if (size < 2) {
        return { ...base, current: await this.namedWarehouses(currentWarehouses), options: [] };
      }
      const combos = coveringCombinations({ required, supplies, size });
      const currentKey = [...currentWarehouses].sort().join('|');
      const alternatives = combos.filter(
        (c) => [...c.warehouseIds].sort().join('|') !== currentKey,
      );
      const names = await this.warehouseNameMap([
        ...new Set([...currentWarehouses, ...alternatives.flatMap((a) => a.warehouseIds)]),
      ]);
      const enrich = (ids: string[]) =>
        ids.map((id) => ({
          id,
          name: names.get(id)?.name ?? null,
          odoo_warehouse_id: names.get(id)?.odoo ?? null,
        }));
      return {
        ...base,
        current: enrich(currentWarehouses),
        options: alternatives.map((a) => ({
          warehouses: enrich(a.warehouseIds),
          total_distance_km: a.totalDistanceKm,
        })),
      };
    }

    const parts = await this.partRepo.find({ where: { orderId }, relations: ['lines'] });
    const live = parts.filter(
      (p) =>
        !FAILED_PART_STATUSES.includes(p.status) &&
        p.status !== OrderPartStatus.CANCELLED,
    );
    const currentWarehouses = [...new Set(live.map((p) => p.warehouseId))];
    const size = currentWarehouses.length;

    const base = {
      order_id: orderId,
      order_number: order.orderNumber,
      split_size: size,
      is_split: size > 1,
    };
    // A single-warehouse order was not split, so there is nothing to swap.
    if (size < 2) {
      return { ...base, current: await this.namedWarehouses(currentWarehouses), options: [] };
    }

    // The whole order, merged from the live parts' lines.
    const requested = this.requestedFromParts(live);
    const required: RequiredLine[] = requested.map((l) => ({
      key: lineKey(l.odooProductId, l.conditionCode),
      quantity: l.quantity,
    }));

    const supplies = await this.buildSupplies(order, requested);
    const combos = coveringCombinations({ required, supplies, size });

    // Never offer the set they already have.
    const currentKey = [...currentWarehouses].sort().join('|');
    const alternatives = combos.filter(
      (c) => [...c.warehouseIds].sort().join('|') !== currentKey,
    );

    const names = await this.warehouseNameMap([
      ...new Set([...currentWarehouses, ...alternatives.flatMap((a) => a.warehouseIds)]),
    ]);
    const enrich = (ids: string[]) =>
      ids.map((id) => ({
        id,
        name: names.get(id)?.name ?? null,
        odoo_warehouse_id: names.get(id)?.odoo ?? null,
      }));

    return {
      ...base,
      current: enrich(currentWarehouses),
      options: alternatives.map((a) => ({
        warehouses: enrich(a.warehouseIds),
        total_distance_km: a.totalDistanceKm,
      })),
    };
  }

  /**
   * Re-routes a SPLIT order onto the exact warehouses the admin chose while
   * modifying it — the pick from `modificationOptions`.
   *
   * Only while the split is still AWAITING_APPROVAL (offered, nothing prepared).
   * The chosen set must be the SAME size as the current split and must cover the
   * whole order; otherwise it is refused rather than shipped short. The current
   * parts are cancelled and their reservations released, and fresh parts are
   * offered to the chosen warehouses — a new allocation round, exactly as if the
   * order had landed on them in the first place.
   */
  async approveSplit(orderId: string, adminId?: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.AWAITING_SPLIT_APPROVAL) {
      throw new ConflictException(
        `This order is not awaiting split approval — it is ${order.status}`,
      );
    }
    const requested = (order.requestedLines ?? []) as RequestedLine[];
    if (!requested.length) throw new BadRequestException('No pending split to approve');
    const required: RequiredLine[] = requested.map((l) => ({
      key: lineKey(l.odooProductId, l.conditionCode),
      quantity: l.quantity,
    }));
    const supplies = await this.buildSupplies(order, requested);
    const plan = planAllocation({ required, supplies, mode: order.fulfilmentMode });
    if (!plan.parts.length || plan.parts.length < 2) {
      throw new BadRequestException('Cannot approve — no split covering set available');
    }
    const warehouseIds = plan.parts.map((p) => p.warehouseId);
    return this.createSplitParts(order, requested, warehouseIds, adminId);
  }

  async rejectSplit(orderId: string, reason?: string, adminId?: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.AWAITING_SPLIT_APPROVAL) {
      throw new ConflictException(
        `This order is not awaiting split approval — it is ${order.status}`,
      );
    }
    order.status = OrderStatus.REJECTED_AWAITING_BUYER;
    order.requestedLines = null;
    order.cancelReason = reason || 'Split order rejected by warehouse manager';
    await this.orderRepo.save(order);
    winstonLogger.info(
      `Order ${order.orderNumber} split REJECTED by ADMIN ${adminId ?? 'system'} — awaiting buyer confirmation`,
      LOG_META,
    );
    return {
      message: 'Split rejected — awaiting buyer confirmation',
      order_id: order.id,
      status: order.status,
    };
  }

  async applyModification(orderId: string, warehouseIds: string[], adminId?: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    const isSplitApproval = order.status === OrderStatus.AWAITING_SPLIT_APPROVAL;
    if (order.status !== OrderStatus.AWAITING_APPROVAL && !isSplitApproval) {
      throw new ConflictException(
        `This order can no longer be modified — it is ${order.status}`,
      );
    }

    if (isSplitApproval) {
      const requested = (order.requestedLines ?? []) as RequestedLine[];
      if (!requested.length) throw new BadRequestException('No pending split to modify');
      const required: RequiredLine[] = requested.map((l) => ({
        key: lineKey(l.odooProductId, l.conditionCode),
        quantity: l.quantity,
      }));
      const supplies = await this.buildSupplies(order, requested);
      const plan = planAllocation({ required, supplies, mode: order.fulfilmentMode });
      const currentWarehouses = plan.parts.map((p) => p.warehouseId);
      if (currentWarehouses.length < 2) {
        throw new BadRequestException('This order is not split — there is nothing to modify');
      }
      const chosen = [...new Set(warehouseIds)];
      if (chosen.length !== currentWarehouses.length) {
        throw new BadRequestException(
          `Choose exactly ${currentWarehouses.length} warehouse(s) — the same number the order was split across`,
        );
      }
      return this.createSplitParts(order, requested, chosen, adminId);
    }

    const parts = await this.partRepo.find({ where: { orderId }, relations: ['lines'] });
    const live = parts.filter(
      (p) =>
        !FAILED_PART_STATUSES.includes(p.status) &&
        p.status !== OrderPartStatus.CANCELLED,
    );
    const currentWarehouses = [...new Set(live.map((p) => p.warehouseId))];
    if (currentWarehouses.length < 2) {
      throw new BadRequestException('This order is not split — there is nothing to modify');
    }
    const chosen = [...new Set(warehouseIds)];
    if (chosen.length !== currentWarehouses.length) {
      throw new BadRequestException(
        `Choose exactly ${currentWarehouses.length} warehouse(s) — the same number the order was split across`,
      );
    }

    const requested = this.requestedFromParts(live);
    const required: RequiredLine[] = requested.map((l) => ({
      key: lineKey(l.odooProductId, l.conditionCode),
      quantity: l.quantity,
    }));
    const supplies = await this.buildSupplies(order, requested);
    const plan = planForWarehouses({ required, supplies, warehouseIds: chosen });
    if (!plan) {
      throw new BadRequestException(
        'Those warehouses cannot cover this order — pick a set from the offered options',
      );
    }

    // Withdraw the current parts and their offers; release their reservations.
    const cancelledPartIds: string[] = [];
    for (const p of live) {
      p.status = OrderPartStatus.CANCELLED;
      p.stockReserved = false;
      await this.partRepo.save(p);
      cancelledPartIds.push(p.id);
    }
    await this.offerRepo.update(
      { orderId, status: OrderOfferStatus.OFFERED },
      { status: OrderOfferStatus.WITHDRAWN, respondedAt: new Date() },
    );

    // Offer fresh parts to the chosen warehouses — a new round.
    const byKey = new Map(
      requested.map((l) => [lineKey(l.odooProductId, l.conditionCode), l]),
    );
    const round = order.allocationRound + 1;
    let sequence = await this.partRepo.count({ where: { orderId } });
    for (const planned of plan.parts) {
      sequence += 1;
      await this.createPart(order, planned, byKey, sequence, round);
    }

    order.allocationRound = round;
    order.status = OrderStatus.AWAITING_APPROVAL;
    await this.recalculateTotals(order);

    // Release the old reservations in Odoo — a remote call, so out of the write
    // path above and best-effort per part.
    for (const partId of cancelledPartIds) {
      await this.odooSync.enqueueCancelOrderPart({
        partId,
        reason: 'Re-routed to different warehouses by the administrator',
      });
    }

    winstonLogger.info(
      `Order ${order.orderNumber} re-routed by ADMIN ${adminId ?? 'system'} to ${plan.parts.length} warehouse(s)`,
      LOG_META,
    );
    return {
      message: 'Order re-routed to the chosen warehouses',
      order_id: orderId,
      warehouses: await this.namedWarehouses(chosen),
      parts: plan.parts.length,
    };
  }

  private async createSplitParts(
    order: Order,
    requested: RequestedLine[],
    warehouseIds: string[],
    adminId?: string,
  ) {
    const required: RequiredLine[] = requested.map((l) => ({
      key: lineKey(l.odooProductId, l.conditionCode),
      quantity: l.quantity,
    }));
    const supplies = await this.buildSupplies(order, requested);
    const plan = planForWarehouses({ required, supplies, warehouseIds });
    if (!plan) {
      throw new BadRequestException(
        'Those warehouses cannot cover this order — pick a set from the offered options',
      );
    }
    const byKey = new Map(requested.map((l) => [lineKey(l.odooProductId, l.conditionCode), l]));
    const round = order.allocationRound + 1;
    let sequence = await this.partRepo.count({ where: { orderId: order.id } });
    for (const planned of plan.parts) {
      sequence += 1;
      await this.createPart(order, planned, byKey, sequence, round);
    }
    order.allocationRound = round;
    order.status = OrderStatus.AWAITING_APPROVAL;
    order.requestedLines = null;
    await this.recalculateTotals(order);
    winstonLogger.info(
      `Order ${order.orderNumber} split approved by ADMIN ${adminId ?? 'system'} → ${plan.parts.length} warehouse(s)`,
      LOG_META,
    );
    return {
      message: 'Split approved — order sent to warehouses',
      order_id: order.id,
      warehouses: await this.namedWarehouses(warehouseIds),
      parts: plan.parts.length,
    };
  }

  /** The whole order as requested lines, merged across the given parts. */
  private requestedFromParts(parts: OrderPart[]): RequestedLine[] {
    const merged = new Map<string, RequestedLine>();
    for (const part of parts) {
      for (const line of part.lines ?? []) {
        const key = lineKey(line.odooProductId as number, line.conditionCode ?? null);
        const existing = merged.get(key);
        if (existing) {
          existing.quantity = round3(existing.quantity + Number(line.quantity));
          continue;
        }
        merged.set(key, {
          productId: line.productId,
          odooProductId: line.odooProductId as number,
          productName: line.productName,
          conditionCode: line.conditionCode ?? null,
          quantity: Number(line.quantity),
          unitType: line.unitType,
          unitPrice: Number(line.unitPrice),
        });
      }
    }
    return [...merged.values()];
  }

  private async warehouseNameMap(
    ids: string[],
  ): Promise<Map<string, { name: string | null; odoo: number | null }>> {
    const map = new Map<string, { name: string | null; odoo: number | null }>();
    if (!ids.length) return map;
    const rows = await this.warehouseRepo.find({
      where: { id: In(ids) },
      select: ['id', 'name', 'odooWarehouseId'],
    });
    for (const w of rows) {
      map.set(w.id, { name: w.name ?? null, odoo: w.odooWarehouseId ?? null });
    }
    return map;
  }

  private async namedWarehouses(ids: string[]) {
    const names = await this.warehouseNameMap(ids);
    return ids.map((id) => ({
      id,
      name: names.get(id)?.name ?? null,
      odoo_warehouse_id: names.get(id)?.odoo ?? null,
    }));
  }

  /**
   * One warehouse's share: the part, its lines, its offer, and the push.
   *
   * The offer row is written in the same breath as the part — it is the record
   * that this warehouse was asked, and the allocator reads it back to make sure
   * a warehouse that says no is never asked again for this order.
   */
  private async createPart(
    order: Order,
    planned: { warehouseId: string; distanceKm: number; lines: { key: string; quantity: number }[] },
    byKey: Map<string, RequestedLine>,
    sequence: number,
    round: number,
  ): Promise<void> {
    const part = await this.partRepo.save(
      this.partRepo.create({
        orderId: order.id,
        warehouseId: planned.warehouseId,
        sequence,
        status: OrderPartStatus.OFFERED,
        distanceKm: String(planned.distanceKm),
      }),
    );

    let goodsTotal = 0;
    for (const line of planned.lines) {
      const source = byKey.get(line.key);
      if (!source) continue;
      const subtotal = round3(line.quantity * source.unitPrice);
      goodsTotal += subtotal;
      await this.lineRepo.save(
        this.lineRepo.create({
          partId: part.id,
          productId: source.productId,
          odooProductId: source.odooProductId,
          productName: source.productName,
          conditionCode: source.conditionCode,
          quantity: String(line.quantity),
          unitType: source.unitType,
          unitPrice: String(source.unitPrice),
          subtotal: String(subtotal),
        }),
      );
    }

    part.goodsTotal = String(round3(goodsTotal));
    // Delivery is priced from the ONE rate the backend admin sets (per km, plus
    // the base fee and the minimum charge) — the same rate the actual trip is
    // costed at, so the estimate a buyer sees here and the figure they are
    // charged when it ships speak in the same numbers. This per-part figure
    // prices the warehouse-to-buyer leg as if delivered alone; the milk-run
    // trip re-costs it lower once the parts are consolidated onto one truck.
    // A collection order has no leg to price.
    if (order.fulfilmentMode === FulfilmentMode.DELIVERY) {
      const quote = await this.rates.quote(planned.distanceKm);
      part.deliveryCost = String(quote.cost);
    }
    await this.partRepo.save(part);

    const now = new Date();
    await this.offerRepo.save(
      this.offerRepo.create({
        partId: part.id,
        orderId: order.id,
        warehouseId: planned.warehouseId,
        roundNumber: round,
        status: OrderOfferStatus.OFFERED,
        offeredAt: now,
        expiresAt: new Date(now.getTime() + OFFER_EXPIRY_HOURS * 3600_000),
      }),
    );

    await this.odooSync.enqueuePushOrderPart({ partId: part.id });
  }

  /**
   * What each candidate warehouse can actually give.
   *
   * Reads the inventory mirror, and subtracts what is already promised to other
   * orders — deciding on the raw quantity is precisely how two orders end up
   * sold the same stock.
   */
  private async buildSupplies(
    order: Order,
    lines: RequestedLine[],
  ): Promise<WarehouseSupply[]> {
    if (!order.provinceId) return [];

    const productIds = [...new Set(lines.map((l) => l.odooProductId))];

    // 1) Which ACTIVE warehouses in the buyer's province actually hold FREE
    //    stock of an ordered material? Only these are worth ranking — an empty
    //    warehouse must never be MEASURED (a paid Google call spent on a
    //    warehouse that can give nothing) nor placed BETWEEN real candidates in
    //    the nearest-first order.
    const stockRows = await this.inventoryRepo
      .createQueryBuilder('i')
      .innerJoin(Warehouse, 'w', 'w.id = i.warehouseId')
      .select('i.warehouseId', 'warehouseId')
      .where('w.provinceId = :provinceId', { provinceId: order.provinceId })
      .andWhere('w.state = :active', { active: WarehouseState.ACTIVE })
      .andWhere('i.odooProductId IN (:...productIds)', { productIds })
      .andWhere('(i.quantity - i.reservedQuantity) > 0')
      .groupBy('i.warehouseId')
      .getRawMany<{ warehouseId: string }>();
    const stockWarehouseIds = stockRows.map((r) => r.warehouseId);
    if (!stockWarehouseIds.length) return [];

    // 2) Drop warehouses that already refused this order.
    const excluded = await this.disqualifiedWarehouses(order.id);
    const eligibleIds = stockWarehouseIds.filter((id) => !excluded.has(id));
    if (!eligibleIds.length) return [];

    // 3) Rank ONLY the stock-holding, eligible warehouses, nearest first.
    const ranked = await this.distance.rankWarehouses({
      buyerProfileId: order.buyerProfileId,
      provinceId: order.provinceId,
      warehouseIds: eligibleIds,
    });
    if (!ranked.length) return [];

    // 4) The per-warehouse availability map (net of other orders' holds).
    const rows = await this.inventoryRepo.find({
      where: {
        warehouseId: In(ranked.map((r) => r.warehouseId)),
        odooProductId: In(productIds),
      },
    });

    const availableByWarehouse = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const free = Number(row.quantity) - Number(row.reservedQuantity);
      if (free <= 0) continue;
      const bucket =
        availableByWarehouse.get(row.warehouseId) ?? new Map<string, number>();
      bucket.set(lineKey(row.odooProductId as number, row.conditionCode), free);
      availableByWarehouse.set(row.warehouseId, bucket);
    }

    return ranked.map((c) => ({
      warehouseId: c.warehouseId,
      distanceKm: c.distanceKm,
      available: availableByWarehouse.get(c.warehouseId) ?? new Map(),
    }));
  }

  /**
   * Warehouses that already said no — or said nothing — for THIS order.
   *
   * The reason reallocation cannot loop: each round's candidate list is
   * strictly smaller than the last.
   */
  private async disqualifiedWarehouses(orderId: string): Promise<Set<string>> {
    const offers = await this.offerRepo.find({
      where: { orderId, status: In([...DISQUALIFYING_OFFER_STATUSES]) },
    });
    return new Set(offers.map((o) => o.warehouseId));
  }

  /** The unserved remainder: the lines of parts that were refused or expired. */
  private async linesFromFailedParts(orderId: string): Promise<RequestedLine[]> {
    const failed = await this.partRepo.find({
      where: { orderId, status: In([...FAILED_PART_STATUSES]) },
      relations: ['lines'],
    });
    // A part can fail more than once across rounds; merge so the same material
    // is looked for once with the full outstanding quantity.
    const merged = new Map<string, RequestedLine>();
    for (const part of failed) {
      for (const line of part.lines ?? []) {
        const key = lineKey(line.odooProductId as number, line.conditionCode ?? null);
        const existing = merged.get(key);
        if (existing) {
          existing.quantity = round3(existing.quantity + Number(line.quantity));
          continue;
        }
        merged.set(key, {
          productId: line.productId,
          odooProductId: line.odooProductId as number,
          productName: line.productName,
          conditionCode: line.conditionCode ?? null,
          quantity: Number(line.quantity),
          unitType: line.unitType,
          unitPrice: Number(line.unitPrice),
        });
      }
    }
    return [...merged.values()];
  }

  /** Totals follow the LIVE parts, so a refused part stops being charged for. */
  async recalculateTotals(order: Order): Promise<Order> {
    const parts = await this.partRepo.find({ where: { orderId: order.id } });
    const live = parts.filter(
      (p) =>
        !FAILED_PART_STATUSES.includes(p.status) &&
        p.status !== OrderPartStatus.CANCELLED,
    );
    const goods = live.reduce((sum, p) => sum + Number(p.goodsTotal), 0);
    const delivery = live.reduce((sum, p) => sum + Number(p.deliveryCost), 0);
    order.goodsTotal = String(round3(goods));
    order.deliveryTotal = String(round3(delivery));
    order.grandTotal = String(round3(goods + delivery));
    return this.orderRepo.save(order);
  }

  private async markExhausted(order: Order): Promise<void> {
    order.status = OrderStatus.NEEDS_ADMIN;
    await this.orderRepo.save(order);
    winstonLogger.warn(
      `Order ${order.orderNumber} could not be allocated after ${order.allocationRound} round(s)`,
      LOG_META,
    );
  }
}

/**
 * Identifies a material AND its grade together.
 *
 * The grade is part of the identity, not a detail: an order for EXCELLENT must
 * never be satisfied from GOOD stock, and folding them into one key is exactly
 * how that would happen.
 */
export function lineKey(
  odooProductId: number,
  conditionCode: string | null | undefined,
): string {
  const code = (conditionCode ?? '').toUpperCase();
  // UNGRADED is UNSORTED stock — it carries no grade. An ungraded material's
  // order arrives with a NULL condition (there is no grade to pick), so its
  // stock, which Odoo mirrors as 'UNGRADED', must map to the SAME no-grade
  // bucket or the order can never be filled from its own stock. A graded order
  // names a real grade ('GOOD'…) and so never collides with this empty bucket.
  const normalized = code === 'UNGRADED' ? '' : code;
  return `${odooProductId}:${normalized}`;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
