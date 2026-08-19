import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';
import { Order } from '../entities/order.entity';
import { OrderPart } from '../entities/order-part.entity';
import { OrderPartLine } from '../entities/order-part-line.entity';
import { OrderPartRating } from '../entities/order-part-rating.entity';
import { OrderComplaint } from '../entities/order-complaint.entity';
import { OrderStatus } from '../enums/order-status.enum';
import {
  FAILED_PART_STATUSES,
  OrderPartStatus,
} from '../enums/order-part-status.enum';
import { FulfilmentMode } from '../enums/fulfilment-mode.enum';
import {
  ComplaintKind,
  ComplaintRoute,
  ComplaintStatus,
  routeFor,
} from '../enums/complaint-kind.enum';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { DeliveryTripService } from './delivery-trip.service';
import { PointsWalletService } from '@src/points-wallet/points-wallet.service';
import { winstonLogger } from '@src/core/logger-config/winston.config';

/**
 * What the buyer sees, and the two things only they can do: confirm they
 * received the goods, and say how it went.
 *
 * The split is shown as it is, never flattened. A buyer collecting from two
 * warehouses needs to know WHICH two and where — hiding that behind one summary
 * line would leave them unable to act on their own order.
 */
@Injectable()
export class OrderViewService {
  constructor(
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderPart) private readonly partRepo: Repository<OrderPart>,
    @InjectRepository(OrderPartLine)
    private readonly lineRepo: Repository<OrderPartLine>,
    @InjectRepository(OrderPartRating)
    private readonly ratingRepo: Repository<OrderPartRating>,
    @InjectRepository(OrderComplaint)
    private readonly complaintRepo: Repository<OrderComplaint>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    private readonly odooSync: OdooSyncService,
    private readonly trips: DeliveryTripService,
    private readonly wallet: PointsWalletService,
  ) {}

  async listMine(accountId: string, page = 1, limit = 10, status?: OrderStatus) {
    const [orders, total] = await this.orderRepo.findAndCount({
      // A status narrows the list to, say, only the buyer's rejected orders;
      // omitted, they see every order they placed.
      where: status
        ? { buyerAccountId: accountId, status }
        : { buyerAccountId: accountId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const summaries = await Promise.all(
      orders.map(async (order) => {
        const parts = await this.partRepo.find({ where: { orderId: order.id } });
        const live = parts.filter((p) => !FAILED_PART_STATUSES.includes(p.status));
        return {
          order_id: order.id,
          order_number: order.orderNumber,
          status: order.status,
          fulfilment_mode: order.fulfilmentMode,
          goods_total: Number(order.goodsTotal),
          delivery_total: Number(order.deliveryTotal),
          grand_total: Number(order.grandTotal),
          currency: order.currency,
          // The headline fact about a split, so the listing already tells the
          // buyer their order comes from more than one place.
          warehouse_count: live.length,
          is_split: live.length > 1,
          created_at: order.createdAt,
        };
      }),
    );

    return {
      message: 'Orders fetched successfully',
      orders: summaries,
      pagination: buildPagination(total, page, limit),
    };
  }

  /**
   * Every buyer's orders, for the ADMIN — optionally narrowed to one status, so
   * the admin desk can pull just the rejected orders, just what needs their
   * attention, and so on. The buyer is named on each row.
   */
  async listAll(page = 1, limit = 10, status?: OrderStatus) {
    const [orders, total] = await this.orderRepo.findAndCount({
      where: status ? { status } : {},
      relations: ['buyerAccount'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const rows = await Promise.all(
      orders.map(async (order) => {
        const parts = await this.partRepo.find({ where: { orderId: order.id } });
        const live = parts.filter((p) => !FAILED_PART_STATUSES.includes(p.status));
        return {
          order_id: order.id,
          order_number: order.orderNumber,
          status: order.status,
          buyer: {
            account_id: order.buyerAccountId,
            name: order.buyerAccount?.name ?? null,
            role: order.buyerRole,
          },
          fulfilment_mode: order.fulfilmentMode,
          consolidate: order.consolidate,
          goods_total: Number(order.goodsTotal),
          grand_total: Number(order.grandTotal),
          currency: order.currency,
          warehouse_count: live.length,
          is_split: live.length > 1,
          created_at: order.createdAt,
        };
      }),
    );

    return {
      message: 'Orders fetched successfully',
      orders: rows,
      pagination: buildPagination(total, page, limit),
    };
  }

  /** One order, with every part laid out as its own task. */
  async detail(accountId: string, orderId: string) {
    const order = await this.mineOrThrow(accountId, orderId);
    const parts = await this.partRepo.find({
      where: { orderId },
      relations: ['warehouse'],
      order: { sequence: 'ASC' },
    });
    const ratings = await this.ratingRepo.find({
      where: parts.length ? { partId: In(parts.map((p) => p.id)) } : { partId: In([]) },
    });
    const ratedParts = new Set(ratings.map((r) => r.partId));

    const live = parts.filter((p) => !FAILED_PART_STATUSES.includes(p.status));

    const detailedParts = await Promise.all(
      live.map(async (part) => {
        const lines = await this.lineRepo.find({ where: { partId: part.id } });
        return {
          part_id: part.id,
          // "Part 2 of 3" — the buyer's mental model of a split order.
          sequence: part.sequence,
          of: live.length,
          status: part.status,
          warehouse: {
            id: part.warehouseId,
            name: part.warehouse?.name,
            // Collection orders need the address; this is where the buyer goes.
            address: part.warehouse?.address,
            latitude: part.warehouse?.latitude,
            longitude: part.warehouse?.longitude,
          },
          distance_km: Number(part.distanceKm),
          delivery_cost: Number(part.deliveryCost),
          goods_total: Number(part.goodsTotal),
          invoice_number: part.invoiceNumber ?? null,
          output_zone: part.outputZoneName ?? null,
          prepared_at: part.finishedAt ?? null,
          dispatched_at: part.dispatchedAt ?? null,
          delivered_at: part.deliveredAt ?? null,
          can_rate:
            part.status === OrderPartStatus.DELIVERED && !ratedParts.has(part.id),
          lines: lines.map((l) => ({
            product_name: l.productName,
            condition: l.conditionCode,
            quantity: Number(l.quantity),
            unit: l.unitType,
            unit_price: Number(l.unitPrice),
            subtotal: Number(l.subtotal),
          })),
        };
      }),
    );

    return {
      message: 'Order fetched successfully',
      order: {
        order_id: order.id,
        order_number: order.orderNumber,
        status: order.status,
        fulfilment_mode: order.fulfilmentMode,
        // Only the buyer's own delivery choice produces a delivery charge.
        delivery_total:
          order.fulfilmentMode === FulfilmentMode.DELIVERY
            ? Number(order.deliveryTotal)
            : 0,
        goods_total: Number(order.goodsTotal),
        grand_total: Number(order.grandTotal),
        currency: order.currency,
        is_split: live.length > 1,
        can_cancel: CANCELLABLE.includes(order.status),
        can_confirm_receipt: order.status === OrderStatus.DELIVERED,
        // Everything the buyer needs to decide on, and act on, consolidation.
        // For a split order they did NOT consolidate, each part above already
        // carries its warehouse's location — that IS the "collect from each"
        // view; this block is the ALTERNATIVE (gather into one) and its state.
        consolidation: await this.buildConsolidationView(order),
        placed_at: order.createdAt,
        preparing_at: order.preparingAt ?? null,
        delivered_at: order.deliveredAt ?? null,
        completed_at: order.completedAt ?? null,
        parts: detailedParts,
      },
    };
  }

  /**
   * The consolidation panel for the order detail: whether the buyer may choose
   * it (and what it would cost), the choice they already made, the live "being
   * gathered" state, and — once gathered — the single warehouse to collect from.
   */
  private async buildConsolidationView(order: Order) {
    const elig = await this.trips.consolidationEligibility(order);

    // The one warehouse to collect from, once gathering is done (or under way).
    let collectFrom: Record<string, unknown> | null = null;
    if (
      order.consolidate &&
      order.consolidationWarehouseId &&
      (order.status === OrderStatus.READY_FOR_PICKUP ||
        order.status === OrderStatus.CONSOLIDATING ||
        order.status === OrderStatus.DELIVERED ||
        order.status === OrderStatus.COMPLETED)
    ) {
      const wh = await this.warehouseRepo.findOne({
        where: { id: order.consolidationWarehouseId },
      });
      if (wh) {
        collectFrom = {
          id: wh.id,
          name: wh.name,
          address: wh.address,
          latitude: wh.latitude,
          longitude: wh.longitude,
        };
      }
    }

    return {
      // The buyer may still CHOOSE it: eligible and not already chosen.
      can_choose: elig.available && !order.consolidate,
      // Their standing choice.
      chosen: order.consolidate,
      // Where it would gather (or is gathering) — the order's warehouse nearest
      // the buyer.
      gathering_warehouse_id:
        order.consolidationWarehouseId ?? elig.consolidation_warehouse_id ?? null,
      estimated_cost: elig.estimated_cost ?? null,
      currency: elig.currency ?? order.currency,
      // A live sentence while a truck is gathering the parts.
      being_gathered: order.status === OrderStatus.CONSOLIDATING,
      // The single place to collect from once gathered.
      collect_from: collectFrom,
      reason: elig.available ? null : elig.reason ?? null,
    };
  }

  /**
   * The buyer confirms the goods reached them.
   *
   * Deliberately the LAST word. Each warehouse manager confirms their own part
   * left, but only the buyer can say it arrived — a system that closed an order
   * on the seller's say-so would have no record of the one fact that matters to
   * the person who paid.
   */
  async confirmReceipt(accountId: string, orderId: string) {
    const order = await this.mineOrThrow(accountId, orderId);
    if (order.status !== OrderStatus.DELIVERED) {
      throw new ConflictException(
        `Receipt can only be confirmed once every part has been handed over — this order is ${order.status}`,
      );
    }
    order.status = OrderStatus.COMPLETED;
    order.completedAt = new Date();
    await this.orderRepo.save(order);

    // Confirming receipt is what earns the buyer their points: the order value
    // is converted at the admin's per-role rate and credited to their wallet,
    // and they are told. Best-effort inside the service — the receipt is
    // confirmed whether or not points could be awarded.
    const award = await this.wallet.awardForOrder(
      accountId,
      order.buyerRole,
      Number(order.grandTotal),
      order.orderNumber,
    );

    return {
      message: 'Receipt confirmed',
      order_id: order.id,
      status: order.status,
      grand_total: Number(order.grandTotal),
      currency: order.currency,
      // What this receipt added to their wallet — null when no rate is set.
      points_awarded: award?.points ?? 0,
      points_balance: award?.balance ?? null,
    };
  }

  /** Rates ONE warehouse's share — see OrderPartRating for why per part. */
  async ratePart(
    accountId: string,
    partId: string,
    stars: number,
    note?: string,
  ) {
    if (stars < 1 || stars > 5) {
      throw new BadRequestException('A rating is between 1 and 5 stars');
    }
    const part = await this.partOrThrow(accountId, partId);
    if (part.status !== OrderPartStatus.DELIVERED) {
      throw new ConflictException(
        'This part has not been delivered yet, so there is nothing to rate',
      );
    }

    // One rating per part: a buyer revises their verdict, they do not stack it.
    const existing = await this.ratingRepo.findOne({ where: { partId } });
    const rating = existing ?? this.ratingRepo.create({ partId, warehouseId: part.warehouseId });
    rating.stars = stars;
    rating.note = note;
    await this.ratingRepo.save(rating);

    return { message: 'Thank you for the feedback', part_id: partId, stars };
  }

  /**
   * Files a complaint about one part, routed by what it is about.
   *
   * Kept open until the responsible side answers — and which side that is
   * follows from the kind, because a shortage is settled by the warehouse's
   * deduction log and a late delivery is not.
   */
  async fileComplaint(
    accountId: string,
    partId: string,
    input: { kind: ComplaintKind; description: string; claimedShortfall?: number },
  ) {
    const part = await this.partOrThrow(accountId, partId);
    if (part.status !== OrderPartStatus.DELIVERED) {
      throw new ConflictException(
        'A complaint can be filed once the goods have been handed over',
      );
    }

    const route = routeFor(input.kind);
    const complaint = await this.complaintRepo.save(
      this.complaintRepo.create({
        partId,
        orderId: part.orderId,
        warehouseId: part.warehouseId,
        kind: input.kind,
        // Stored, not derived on read: changing the routing rules later must
        // not silently move complaints already being worked on.
        route,
        status: ComplaintStatus.OPEN,
        description: input.description,
        claimedShortfall:
          input.claimedShortfall != null ? String(input.claimedShortfall) : undefined,
      }),
    );

    // A warehouse-routed complaint (shortage / quality) is decided from the
    // deduction evidence, which lives in Odoo — so the warehouse's manager is
    // told there. Delivery / billing complaints stay with the platform admin
    // (they appear on the backend complaints desk). Best-effort: a complaint is
    // filed here even if the notification cannot be queued.
    if (route === ComplaintRoute.WAREHOUSE) {
      await this.notifyWarehouseOfComplaint(complaint.id, part).catch((e) =>
        winstonLogger.warn(
          `Complaint ${complaint.id} filed but not sent to the warehouse: ${(e as Error).message}`,
          { context: 'COMPLAINT', channel: 'orders' },
        ),
      );
    }

    return {
      message: 'Complaint filed',
      complaint_id: complaint.id,
      routed_to: complaint.route,
    };
  }

  /** Queue a notification to the warehouse's manager in Odoo. */
  /**
   * Files a complaint against the WHOLE order — the buyer-facing way.
   *
   * The buyer sees one order, never the warehouse split, so they complain about
   * the order, not a part. One complaint row is written with no part and no
   * single warehouse; a warehouse-routed kind (shortage / quality) is then fanned
   * out to EVERY warehouse that fulfilled the order, so each manager sees the
   * dispute against their own deduction log. Delivery / billing kinds stay with
   * the admin desk exactly as before.
   */
  async fileOrderComplaint(
    accountId: string,
    orderId: string,
    input: { kind: ComplaintKind; description: string; claimedShortfall?: number },
  ) {
    const order = await this.mineOrThrow(accountId, orderId);
    if (
      order.status !== OrderStatus.DELIVERED &&
      order.status !== OrderStatus.COMPLETED
    ) {
      throw new ConflictException(
        'A complaint can be filed once the goods have been handed over',
      );
    }

    const route = routeFor(input.kind);
    const complaint = await this.complaintRepo.save(
      this.complaintRepo.create({
        // Whole-order scope: no part, no single warehouse.
        orderId,
        partId: undefined,
        warehouseId: undefined,
        kind: input.kind,
        route,
        status: ComplaintStatus.OPEN,
        description: input.description,
        claimedShortfall:
          input.claimedShortfall != null ? String(input.claimedShortfall) : undefined,
      }),
    );

    if (route === ComplaintRoute.WAREHOUSE) {
      await this.notifyOrderWarehousesOfComplaint(complaint.id, order).catch((e) =>
        winstonLogger.warn(
          `Order complaint ${complaint.id} filed but not sent to the warehouses: ${(e as Error).message}`,
          { context: 'COMPLAINT', channel: 'orders' },
        ),
      );
    }

    return {
      message: 'Complaint filed',
      complaint_id: complaint.id,
      order_id: orderId,
      routed_to: complaint.route,
    };
  }

  /**
   * Fans a whole-order warehouse complaint out to every warehouse that fulfilled
   * it — one push per distinct warehouse of the order's live parts, so no
   * manager is left out and none is told twice.
   */
  private async notifyOrderWarehousesOfComplaint(complaintId: string, order: Order) {
    const complaint = await this.complaintRepo.findOne({ where: { id: complaintId } });
    if (!complaint) return;
    const parts = await this.partRepo.find({ where: { orderId: order.id } });
    const live = parts.filter((p) => !FAILED_PART_STATUSES.includes(p.status));
    const warehouseIds = [...new Set(live.map((p) => p.warehouseId))];
    if (!warehouseIds.length) return;

    const warehouses = await this.warehouseRepo.find({ where: { id: In(warehouseIds) } });
    for (const warehouse of warehouses) {
      if (!warehouse.odooWarehouseId) continue; // not mirrored → nothing to notify
      await this.odooSync.enqueuePushComplaint({
        complaintId,
        odooWarehouseId: warehouse.odooWarehouseId,
        kind: complaint.kind,
        description: complaint.description,
        orderNumber: order.orderNumber ?? '',
      });
    }
  }

  private async notifyWarehouseOfComplaint(complaintId: string, part: OrderPart) {
    const complaint = await this.complaintRepo.findOne({ where: { id: complaintId } });
    if (!complaint) return;
    const [warehouse, order] = await Promise.all([
      this.warehouseRepo.findOne({ where: { id: part.warehouseId } }),
      this.orderRepo.findOne({ where: { id: part.orderId } }),
    ]);
    if (!warehouse?.odooWarehouseId) return; // not mirrored → nothing to notify
    await this.odooSync.enqueuePushComplaint({
      complaintId,
      odooWarehouseId: warehouse.odooWarehouseId,
      kind: complaint.kind,
      description: complaint.description,
      orderNumber: order?.orderNumber ?? '',
    });
  }

  private async mineOrThrow(accountId: string, orderId: string): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    // Same answer whether it does not exist or belongs to someone else: a 403
    // here would confirm that another buyer's order id is real.
    if (!order || order.buyerAccountId !== accountId) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  private async partOrThrow(accountId: string, partId: string): Promise<OrderPart> {
    const part = await this.partRepo.findOne({ where: { id: partId } });
    if (!part) throw new NotFoundException('Order part not found');
    await this.mineOrThrow(accountId, part.orderId);
    return part;
  }
}

const CANCELLABLE = [
  OrderStatus.PENDING_ALLOCATION,
  OrderStatus.AWAITING_APPROVAL,
  OrderStatus.NEEDS_CUSTOMER_DECISION,
  OrderStatus.NEEDS_ADMIN,
];
