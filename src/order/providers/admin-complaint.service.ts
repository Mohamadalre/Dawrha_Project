import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { Order } from '../entities/order.entity';
import { OrderComplaint } from '../entities/order-complaint.entity';
import {
  ComplaintKind,
  ComplaintRoute,
  ComplaintStatus,
} from '../enums/complaint-kind.enum';

/**
 * The admin's side of the complaints a buyer files.
 *
 * A complaint is about the ORDER — the buyer, the delivery, the price — which
 * are the platform's concern, not the warehouse's floor. So the platform admin
 * reads and answers them here. (Shortage and quality complaints are ROUTED to
 * the warehouse instead, where the deduction log lives; they still appear in the
 * list so the admin can see everything, but the admin resolves the delivery,
 * billing and "other" ones.)
 *
 * Only OPEN or IN_REVIEW complaints can be decided — a resolved or rejected one
 * is closed, and re-deciding it would erase the answer the buyer was already
 * given.
 */
@Injectable()
export class AdminComplaintService {
  constructor(
    @InjectRepository(OrderComplaint)
    private readonly complaintRepo: Repository<OrderComplaint>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
  ) {}

  async list(query: {
    status?: ComplaintStatus;
    route?: ComplaintRoute;
    kind?: ComplaintKind;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);

    const qb = this.complaintRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.warehouse', 'w')
      .orderBy('c.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    if (query.status) qb.andWhere('c.status = :status', { status: query.status });
    if (query.route) qb.andWhere('c.route = :route', { route: query.route });
    if (query.kind) qb.andWhere('c.kind = :kind', { kind: query.kind });

    const [rows, total] = await qb.getManyAndCount();
    const context = await this.orderContext(rows.map((c) => c.orderId));

    return {
      complaints: rows.map((c) => this.view(c, context.get(c.orderId))),
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async detail(id: string) {
    const complaint = await this.complaintRepo.findOne({
      where: { id },
      relations: ['warehouse'],
    });
    if (!complaint) throw new NotFoundException('Complaint not found');
    const context = await this.orderContext([complaint.orderId]);
    return { complaint: this.view(complaint, context.get(complaint.orderId)) };
  }

  /**
   * The admin's decision on a complaint. RESOLVED or REJECTED closes it and
   * stamps who and when; IN_REVIEW just marks it as being looked at. A closed
   * complaint cannot be re-decided.
   */
  async decide(
    id: string,
    adminId: string,
    input: { status: ComplaintStatus; resolution?: string },
  ) {
    const complaint = await this.complaintRepo.findOne({ where: { id } });
    if (!complaint) throw new NotFoundException('Complaint not found');

    if (
      complaint.status === ComplaintStatus.RESOLVED ||
      complaint.status === ComplaintStatus.REJECTED
    ) {
      throw new BadRequestException(
        'This complaint is already closed and cannot be decided again',
      );
    }

    const closing =
      input.status === ComplaintStatus.RESOLVED ||
      input.status === ComplaintStatus.REJECTED;
    if (closing && !input.resolution?.trim()) {
      throw new BadRequestException(
        'A resolution note is required when resolving or rejecting a complaint',
      );
    }

    complaint.status = input.status;
    if (input.resolution) complaint.resolution = input.resolution.trim();
    if (closing) {
      complaint.resolvedBy = adminId;
      complaint.resolvedAt = new Date();
    }
    await this.complaintRepo.save(complaint);

    winstonLogger.info(
      `Complaint ${id} -> ${input.status} by admin ${adminId}`,
      { context: 'COMPLAINT', channel: 'orders' },
    );
    return {
      message: 'Complaint updated',
      complaint_id: id,
      status: complaint.status,
    };
  }

  /** Order number + buyer id for each complaint's order, in one query. */
  private async orderContext(
    orderIds: string[],
  ): Promise<Map<string, { orderNumber: string; buyerAccountId: string }>> {
    const map = new Map<string, { orderNumber: string; buyerAccountId: string }>();
    const unique = [...new Set(orderIds)];
    if (!unique.length) return map;
    const orders = await this.orderRepo.find({ where: { id: In(unique) } });
    for (const o of orders) {
      map.set(o.id, { orderNumber: o.orderNumber, buyerAccountId: o.buyerAccountId });
    }
    return map;
  }

  private view(
    c: OrderComplaint,
    ctx?: { orderNumber: string; buyerAccountId: string },
  ) {
    return {
      id: c.id,
      // The order, the buyer and the warehouse each as one object — id AND name
      // together — instead of scattered *_id / *_name / *_number pairs.
      order: { id: c.orderId, number: ctx?.orderNumber ?? null },
      buyer: { account_id: ctx?.buyerAccountId ?? null },
      part_id: c.partId,
      warehouse: { id: c.warehouseId, name: c.warehouse?.name ?? null },
      kind: c.kind,
      route: c.route,
      status: c.status,
      description: c.description,
      claimed_shortfall: c.claimedShortfall != null ? Number(c.claimedShortfall) : null,
      resolution: c.resolution ?? null,
      resolved_by: c.resolvedBy ?? null,
      resolved_at: c.resolvedAt ?? null,
      created_at: c.createdAt,
    };
  }
}
