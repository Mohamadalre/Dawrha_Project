import { BadRequestException, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role } from '@src/user/enums/role.enum';
import { Product } from '@src/waste-management/entities/product.entity';
import { UnitsService } from '@src/waste-management/common/providers/units.service';
import { EffectivePriceService } from '@src/waste-management/common/providers/effective-price.service';
import { ProductNotFoundException } from '@src/waste-management/exceptions/waste.exceptions';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { CollectionRequest } from '../entities/collection-request.entity';
import { CollectionRequestLine } from '../entities/collection-request-line.entity';
import { CollectionRequestAssignment } from '../entities/collection-request-assignment.entity';
import { CollectionStateService } from '../providers/collection-state.service';
import {
  CollectionRequestType,
} from '../enums/collection-request-type.enum';
import {
  CollectionRequestStatus,
  PRODUCER_CANCELLABLE_STATUSES,
} from '../enums/collection-request-status.enum';
import {
  CollectionRequestAssignmentStatus,
} from '../enums/collection-request-assignment-status.enum';
import {
  CollectionRequestNotFoundException,
  CollectionRequestNotOwnedException,
  CollectionRequestNotCancellableException,
  DuplicateLineProductException,
  EmptyRequestLinesException,
  InvalidScheduleException,
} from '../exceptions/collection-request.exceptions';
import { CreateCollectionRequestDto } from '../dto/create-collection-request.dto';
import { ListCollectionRequestsQueryDto } from '../dto/list-collection-requests.dto';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';
import { nextSequentialNumber } from '../utils/sequence.util';
import { estimateWeightKg } from '../utils/weight.util';

const LOG_META = { context: 'COLLECTION_REQUEST', channel: 'collection' } as const;

interface Caller {
  id: string;
  role: Role;
}

interface BuildableLine {
  productId: string;
  productName: string;
  unitType: string;
  quantity: string;
  unitPrice: string;
  total: string;
  note?: string | null;
  weightKg: number;
}

@Injectable()
export class CollectionRequestService {
  constructor(
    @InjectRepository(CollectionRequest)
    private readonly requestRepo: Repository<CollectionRequest>,
    @InjectRepository(CollectionRequestLine)
    private readonly lineRepo: Repository<CollectionRequestLine>,
    @InjectRepository(CollectionRequestAssignment)
    private readonly assignmentRepo: Repository<CollectionRequestAssignment>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly units: UnitsService,
    // The single resolver for "what does THIS role earn for THIS material right
    // now" — list price with any live offer applied in the right direction for
    // a SELLER. The request must not compute that itself: a second copy of the
    // sign is how a request that adds ends up beside a catalogue that subtracts.
    private readonly effectivePrice: EffectivePriceService,
    private readonly state: CollectionStateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------
  async create(caller: Caller, dto: CreateCollectionRequestDto) {
    if (!dto.lines?.length) throw new EmptyRequestLinesException();
    const ids = dto.lines.map((l) => l.product_id);
    if (new Set(ids).size !== ids.length) {
      throw new DuplicateLineProductException();
    }

    const products = await this.productRepo.find({
      where: { id: In(ids), isActive: true },
    });
    const found = new Map(products.map((p) => [p.id, p]));
    const weightCodes = await this.units.weightCodes();

    const lines: BuildableLine[] = [];
    for (const line of dto.lines) {
      const product = found.get(line.product_id);
      if (!product) throw new ProductNotFoundException();

      // Producers are priced flat (no grades), exactly like the catalogue shows
      // them; the offer direction is already correct for a seller.
      const effective = await this.effectivePrice.effectivePrice(
        product.id,
        caller.role,
        null,
      );
      if (!effective) {
        throw new BadRequestException('This material has no price for your account type');
      }

      const unitPrice = Number(effective.price);
      const total = +(unitPrice * line.quantity).toFixed(3);
      const weightKg = estimateWeightKg(product, line.quantity, weightCodes);

      lines.push({
        productId: product.id,
        productName: product.name,
        unitType: product.unitType,
        quantity: String(line.quantity),
        unitPrice: String(unitPrice),
        total: String(total),
        note: line.note ?? null,
        weightKg,
      });
    }

    const scheduledAt = dto.scheduled_at ? new Date(dto.scheduled_at) : null;
    if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
      throw new InvalidScheduleException();
    }
    const type = scheduledAt
      ? CollectionRequestType.SCHEDULED
      : CollectionRequestType.IMMEDIATE;

    const estimatedWeightKg = +lines.reduce((s, l) => s + l.weightKg, 0).toFixed(3);
    const estimatedGrandTotal = +lines
      .reduce((s, l) => s + Number(l.total), 0)
      .toFixed(3);

    const request = this.requestRepo.create({
      requestNumber: await nextSequentialNumber(
        this.requestRepo,
        'requestNumber',
        this.requestPrefix(),
        5,
      ),
      accountId: caller.id,
      type,
      status: CollectionRequestStatus.CREATED,
      contactName: dto.contact_name ?? null,
      contactPhone: dto.contact_phone ?? null,
      addressText: dto.address_text ?? null,
      lat: dto.lat != null ? String(dto.lat) : null,
      lng: dto.lng != null ? String(dto.lng) : null,
      scheduledAt,
      estimatedWeightKg: String(estimatedWeightKg),
      estimatedGrandTotal: String(estimatedGrandTotal),
      lines: lines.map((l) => this.lineRepo.create(l)),
    });
    const saved = await this.requestRepo.save(request);

    // Immediate requests enter the queue right away and the engine elects a
    // driver at once. Scheduled and plan requests stay CREATED until their
    // lead-time window opens (scheduleWindow), so they can never be elected
    // early — the producer's chosen slot is honoured.
    if (saved.type === CollectionRequestType.IMMEDIATE) {
      this.state.applyRequestStatus(saved, CollectionRequestStatus.QUEUED);
      await this.requestRepo.save(saved);
    }

    // The dispatch engine reacts to this event: immediate requests are elected
    // right away, scheduled ones get their lead-time window job.
    this.eventEmitter.emit('collection.request.queued', { requestId: saved.id });

    return this.toView(saved);
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------
  async list(caller: Caller, query: ListCollectionRequestsQueryDto) {
    const [rows, total] = await this.requestRepo.findAndCount({
      where: {
        accountId: caller.id,
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      relations: ['lines'],
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      requests: rows.map((r) => this.toView(r)),
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  async detail(caller: Caller, id: string) {
    const request = await this.loadOwned(caller.id, id);
    return this.toView(request);
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------
  async cancel(caller: Caller, id: string, reason?: string) {
    const request = await this.loadOwned(caller.id, id);
    return this.performCancel(request, reason, caller.id);
  }

  /** The admin's cancel: same flow, no ownership check. */
  async adminCancel(adminId: string, id: string, reason?: string) {
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: ['lines'],
    });
    if (!request) throw new CollectionRequestNotFoundException();
    return this.performCancel(request, reason, adminId);
  }

  private async performCancel(
    request: CollectionRequest,
    reason: string | undefined,
    byId: string,
  ) {
    if (!PRODUCER_CANCELLABLE_STATUSES.includes(request.status)) {
      throw new CollectionRequestNotCancellableException();
    }

    // Any offer still open is withdrawn — the election ledger stays clean.
    const open = await this.assignmentRepo.find({
      where: {
        requestId: request.id,
        status: CollectionRequestAssignmentStatus.OFFERED,
      },
    });
    for (const assignment of open) {
      this.state.applyAssignmentStatus(
        assignment,
        CollectionRequestAssignmentStatus.WITHDRAWN,
      );
    }
    if (open.length) await this.assignmentRepo.save(open);

    request.cancellationReason = reason ?? null;
    this.state.applyRequestStatus(request, CollectionRequestStatus.CANCELLED);
    const saved = await this.requestRepo.save(request);

    // The engine cleans its Redis offer keys and tells the request room.
    this.eventEmitter.emit('collection.request.cancelled', {
      requestId: saved.id,
    });

    winstonLogger.info(
      `Collection request ${request.requestNumber} cancelled by ${byId}${reason ? `: ${reason}` : ''}`,
      LOG_META,
    );
    return this.toView(saved);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private async loadOwned(accountId: string, id: string): Promise<CollectionRequest> {
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: ['lines'],
    });
    if (!request) throw new CollectionRequestNotFoundException();
    if (request.accountId !== accountId) {
      throw new CollectionRequestNotOwnedException();
    }
    return request;
  }

  /**
   * CR-YYYYMM-##### — the running per-month sequence; the unique constraint is
   * the backstop. Shared with the plan generator so the two never collide.
   */
  private requestPrefix(): string {
    const now = new Date();
    return `CR-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private toView(request: CollectionRequest) {
    return {
      request_id: request.id,
      request_number: request.requestNumber,
      type: request.type,
      status: request.status,
      scheduled_at: request.scheduledAt ?? null,
      contact_name: request.contactName,
      contact_phone: request.contactPhone,
      address_text: request.addressText,
      lat: request.lat ? Number(request.lat) : null,
      lng: request.lng ? Number(request.lng) : null,
      estimated_weight_kg: Number(request.estimatedWeightKg),
      estimated_grand_total: Number(request.estimatedGrandTotal),
      actual_weight_kg: request.actualWeightKg != null ? Number(request.actualWeightKg) : null,
      actual_grand_total:
        request.actualGrandTotal != null ? Number(request.actualGrandTotal) : null,
      route_id: request.routeId ?? null,
      route_sequence: request.routeSequence ?? null,
      cancellation_reason: request.cancellationReason,
      assigned_at: request.assignedAt,
      en_route_at: request.enRouteAt,
      arrived_at: request.arrivedAt,
      picked_at: request.pickedAt,
      delivered_at: request.deliveredAt,
      completed_at: request.completedAt,
      cancelled_at: request.cancelledAt,
      created_at: request.createdAt,
      updated_at: request.updatedAt,
      lines: (request.lines ?? []).map((l) => ({
        line_id: l.id,
        product_id: l.productId,
        product_name: l.productName,
        unit_type: l.unitType,
        quantity: Number(l.quantity),
        unit_price: Number(l.unitPrice),
        total: Number(l.total),
        note: l.note,
      })),
    };
  }
}
