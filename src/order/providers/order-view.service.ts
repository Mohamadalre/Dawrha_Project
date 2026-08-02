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
import { ComplaintKind, ComplaintStatus, routeFor } from '../enums/complaint-kind.enum';

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
  ) {}

  async listMine(accountId: string, page = 1, limit = 10) {
    const [orders, total] = await this.orderRepo.findAndCount({
      where: { buyerAccountId: accountId },
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
        placed_at: order.createdAt,
        preparing_at: order.preparingAt ?? null,
        delivered_at: order.deliveredAt ?? null,
        completed_at: order.completedAt ?? null,
        parts: detailedParts,
      },
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
    return {
      message: 'Receipt confirmed',
      order_id: order.id,
      status: order.status,
      grand_total: Number(order.grandTotal),
      currency: order.currency,
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

    const complaint = await this.complaintRepo.save(
      this.complaintRepo.create({
        partId,
        orderId: part.orderId,
        warehouseId: part.warehouseId,
        kind: input.kind,
        // Stored, not derived on read: changing the routing rules later must
        // not silently move complaints already being worked on.
        route: routeFor(input.kind),
        status: ComplaintStatus.OPEN,
        description: input.description,
        claimedShortfall:
          input.claimedShortfall != null ? String(input.claimedShortfall) : undefined,
      }),
    );

    return {
      message: 'Complaint filed',
      complaint_id: complaint.id,
      routed_to: complaint.route,
    };
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
