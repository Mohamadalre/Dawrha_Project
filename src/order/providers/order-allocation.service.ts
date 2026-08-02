import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { DeliveryQuoteService } from '@src/warehouse/providers/delivery-quote.service';
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
  planAllocation,
  shortfallRatio,
} from './allocation-planner';
import { DistanceService } from './distance.service';

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
    private readonly distance: DistanceService,
    private readonly deliveryQuote: DeliveryQuoteService,
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
    // to ship quietly.
    const missing = shortfallRatio(plan, required);
    const withinTolerance = missing <= PARTIAL_FULFILMENT_TOLERANCE;
    if (!plan.fullyCovered && !(order.acceptPartialFulfilment && withinTolerance)) {
      order.status = OrderStatus.NEEDS_CUSTOMER_DECISION;
      await this.orderRepo.save(order);
      return { result: 'PARTIAL_NEEDS_BUYER', missingRatio: missing };
    }

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
    // Delivery is priced per leg, from the tariff mirror Odoo's admin authors.
    // A collection order has no leg to price.
    if (order.fulfilmentMode === FulfilmentMode.DELIVERY) {
      const quote = await this.deliveryQuote.quoteLeg({
        warehouseId: planned.warehouseId,
        provinceId: order.provinceId,
        distanceKm: planned.distanceKm,
      });
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

    const ranked = await this.distance.rankWarehouses({
      buyerProfileId: order.buyerProfileId,
      provinceId: order.provinceId,
    });
    if (!ranked.length) return [];

    const excluded = await this.disqualifiedWarehouses(order.id);
    const candidates = ranked.filter((r) => !excluded.has(r.warehouseId));
    if (!candidates.length) return [];

    const productIds = [...new Set(lines.map((l) => l.odooProductId))];
    const rows = await this.inventoryRepo.find({
      where: {
        warehouseId: In(candidates.map((c) => c.warehouseId)),
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

    return candidates.map((c) => ({
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
  return `${odooProductId}:${(conditionCode ?? '').toUpperCase()}`;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
