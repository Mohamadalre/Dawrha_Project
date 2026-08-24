import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Shipment } from '../entities/shipment.entity';
import { CollectionRequest } from '../entities/collection-request.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { TruckHandover } from '@src/truck/entities/truck-handover.entity';
import { HandoverStatus } from '@src/truck/enums/handover-status.enum';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { ShipmentStatus } from '../enums/shipment-status.enum';
import { CollectionRequestStatus } from '../enums/collection-request-status.enum';
import { DispatchGatewayEvents } from '../gateways/dispatch.gateway';
import {
  canTransitionShipment,
} from '../enums/shipment-status.enum';
import { DeliverShipmentDto } from '../dto/shipment.dto';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const LOG_META = { context: 'SHIPMENT_SERVICE', channel: 'collection' } as const;

/** A shipment id is a UUID; anything else off a QR is treated as not-found. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ShipmentService {
  private readonly logger = new Logger('SHIPMENT_SERVICE');

  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(CollectionRequest)
    private readonly requestRepo: Repository<CollectionRequest>,
    @InjectRepository(CollectorProfile)
    private readonly driverRepo: Repository<CollectorProfile>,
    @InjectRepository(TruckAssignmentEntity)
    private readonly assignmentRepo: Repository<TruckAssignmentEntity>,
    @InjectRepository(TruckHandover)
    private readonly handoverRepo: Repository<TruckHandover>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,

    private readonly events: DispatchGatewayEvents,

  ) {}

  // ---------------------------------------------------------------------------
  // Auto-creation: called by DispatchEngineService when driver accepts an offer
  // ---------------------------------------------------------------------------

  /**
   * Called when a driver accepts a collection request offer.
   * If no active shipment exists, creates one automatically.
   * Links the request to the (new or existing) shipment.
   */
  async autoCreateOrAddToShipment(
    driverId: string,
    request: CollectionRequest,
  ): Promise<void> {
    const active = await this.activeShipment(driverId);

    if (active) {
      await this.addToShipment(active, request);
      return;
    }

    const shipment = await this.createShipment(driverId, request);
    await this.addToShipment(shipment, request);
  }

  // ---------------------------------------------------------------------------
  // Auto-depart: called by RouteExecutionService on first arrival
  // ---------------------------------------------------------------------------

  /**
   * Auto-depart the shipment (CREATED → IN_TRANSIT) when the driver arrives
   * at the first pickup stop. Only acts if the shipment is in CREATED status.
   */
  async autoDepartOnArrival(driverId: string): Promise<void> {
    const active = await this.activeShipment(driverId);
    if (!active || active.status !== ShipmentStatus.CREATED) return;

    active.status = ShipmentStatus.IN_TRANSIT;
    active.departedAt = new Date();
    await this.shipmentRepo.save(active);
  }

  // ---------------------------------------------------------------------------
  // Auto-deliver: called by RouteExecutionService when route completes
  // ---------------------------------------------------------------------------

  /**
   * Auto-deliver the shipment when all requests in the route are done.
   * If the shipment is in IN_TRANSIT (or CREATED if it was never departed),
   * marks it DELIVERED and completes all linked requests.
   */
  async autoDeliverOnRouteComplete(driverId: string): Promise<void> {
    const active = await this.activeShipment(driverId);
    if (!active) return;
    if (active.status === ShipmentStatus.DELIVERED || active.status === ShipmentStatus.CANCELLED) return;

    const now = new Date();

    // If warehouseId is still null, resolve from handover
    if (!active.warehouseId) {
      const warehouseId = await this.resolveWarehouseId(driverId);
      if (warehouseId) {
        active.warehouseId = warehouseId;
      }
    }

    // Recalculate totals from linked requests
    const requests = await this.requestRepo.find({
      where: { shipmentId: active.id },
    });

    active.status = ShipmentStatus.DELIVERED;
    active.deliveredAt = now;
    active.totalRequests = requests.length;
    active.totalWeightKg = String(
      requests.reduce(
        (sum, r) => sum + (parseFloat(r.actualWeightKg || r.estimatedWeightKg) || 0),
        0,
      ),
    );
    await this.shipmentRepo.save(active);

    // Mark all linked requests as COMPLETED
    for (const r of requests) {
      r.status = CollectionRequestStatus.COMPLETED;
      r.completedAt = now;
      r.deliveredAt = r.deliveredAt || now;
    }
    await this.requestRepo.save(requests);
  }

  // ---------------------------------------------------------------------------
  // Driver: list my shipments
  // ---------------------------------------------------------------------------
  async myShipments(accountId: string) {
    const driver = await this.getDriver(accountId);
    const shipments = await this.shipmentRepo.find({
      where: { driverId: driver.id },
      order: { createdAt: 'DESC' },
      relations: ['warehouse'],
    });
    return shipments.map((s) => this.serialize(s));
  }

  // ---------------------------------------------------------------------------
  // Driver: shipment detail
  // ---------------------------------------------------------------------------
  async detail(accountId: string, shipmentId: string) {
    const driver = await this.getDriver(accountId);
    const shipment = await this.shipmentRepo.findOne({
      where: { id: shipmentId, driverId: driver.id },
      relations: ['warehouse', 'requests'],
    });
    if (!shipment) throw new NotFoundException('Shipment not found');

    const requests = await this.requestRepo.find({
      where: { shipmentId: shipment.id },
      relations: ['lines'],
      order: { routeSequence: 'ASC' },
    });

    return {
      ...this.serialize(shipment),
      requests: requests.map((r) => ({
        id: r.id,
        request_number: r.requestNumber,
        status: r.status,
        route_sequence: r.routeSequence,
        actual_weight_kg: r.actualWeightKg,
        estimated_weight_kg: r.estimatedWeightKg,
        lines: (r.lines || []).map((l) => ({
          product_name: l.productName,
          quantity: l.quantity,
          unit_type: l.unitType,
        })),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Reception (Odoo → backend): the receiving employee scanned the shipment QR
  // ---------------------------------------------------------------------------
  /**
   * The RECEPTION employee (in Odoo) scanned this shipment's QR. Called
   * server-to-server from Odoo (shared-secret authed), never by a JWT client.
   *
   * Enforces warehouse ISOLATION — a warehouse may only receive its OWN trucks,
   * never another warehouse's — then flips the backend shipment to DELIVERED so
   * the driver sees it received, completes its requests, and RETURNS the load
   * (materials + quantities + unit + total weight + driver + truck) so Odoo can
   * mirror it as one `recycle.shipment` that enters the normal reception/sorting
   * flow. Materials travel AGGREGATED per product — reception, sorting and
   * storage only ever work off the shipment totals; the per-request breakdown is
   * returned too, for the admin alone.
   *
   * Idempotent: a second scan of an already-received shipment returns the same
   * load without erroring.
   */
  /**
   * Load a shipment for the reception scan and enforce warehouse ISOLATION —
   * the one hard rule: the shipment's warehouse must be the receiving
   * employee's own, or the truck is not theirs to receive. Shared by the scan
   * (fetch) and the confirm steps so both apply the exact same guard. Returns
   * the shipment (with relations) and its ordered requests. Does NOT change any
   * status — that is the confirm step's job alone.
   */
  private async loadShipmentForReception(
    backendShipmentId: string,
    warehouseBackendId: string,
  ): Promise<{ shipment: Shipment; requests: CollectionRequest[] }> {
    // The id must be a shipment UUID. A QR that carries something else — a
    // label like "DAWRHA-DRIVER:…", a driver code, or a typo — must read as a
    // clean "not found", never a raw Postgres "invalid uuid" 500 that looks
    // like a bug in the reception screen.
    if (!UUID_RE.test((backendShipmentId ?? '').trim())) {
      throw new NotFoundException('Shipment not found');
    }
    const shipment = await this.shipmentRepo.findOne({
      where: { id: backendShipmentId.trim() },
      relations: ['warehouse', 'truck', 'driver', 'driver.account'],
    });
    if (!shipment) throw new NotFoundException('Shipment not found');

    // The destination warehouse: set at pickup, or resolved from the driver's
    // handover when it was never stamped.
    if (!shipment.warehouseId) {
      const wid = await this.resolveWarehouseId(shipment.driverId);
      if (wid) shipment.warehouseId = wid;
    }
    if (!shipment.warehouseId || shipment.warehouseId !== warehouseBackendId) {
      throw new ForbiddenException(
        'This shipment does not belong to your warehouse',
      );
    }

    const requests = await this.requestRepo.find({
      where: { shipmentId: shipment.id },
      relations: ['lines'],
      order: { routeSequence: 'ASC' },
    });
    return { shipment, requests };
  }

  /**
   * RECEPTION SCAN — read only. Fetch the shipment's load (materials +
   * quantities + unit + weight + driver + truck) for the reception screen and
   * mirror into Odoo. Enforces warehouse isolation but leaves the backend
   * status UNTOUCHED: scanning is a look, not a receipt. The status flips only
   * when the employee CONFIRMS — see {@link confirmShipmentReceipt}.
   */
  async getShipmentForReception(
    backendShipmentId: string,
    warehouseBackendId: string,
  ) {
    const { shipment, requests } = await this.loadShipmentForReception(
      backendShipmentId,
      warehouseBackendId,
    );
    return this.buildReceptionPayload(shipment, requests, warehouseBackendId);
  }

  /**
   * RECEPTION CONFIRM — the receiving employee accepts the truck in Odoo. NOW
   * the backend shipment moves to RECEIVED and its requests complete, so the
   * driver sees the receipt. Re-confirming is idempotent: an already-RECEIVED
   * shipment just returns its load. (DELIVERED — the driver's drop — may
   * already be set by the auto route-complete step; RECEIVED is the reception's
   * own, later, transition.)
   */
  async confirmShipmentReceipt(
    backendShipmentId: string,
    warehouseBackendId: string,
  ) {
    const { shipment, requests } = await this.loadShipmentForReception(
      backendShipmentId,
      warehouseBackendId,
    );

    const now = new Date();
    if (shipment.status !== ShipmentStatus.RECEIVED) {
      this.guardTransition(shipment.status, ShipmentStatus.RECEIVED);
      shipment.status = ShipmentStatus.RECEIVED;
      shipment.deliveredAt = shipment.deliveredAt || now;
      shipment.totalRequests = requests.length;
      shipment.totalWeightKg = String(
        requests.reduce(
          (s, r) => s + (parseFloat(r.actualWeightKg || r.estimatedWeightKg) || 0),
          0,
        ),
      );
      await this.shipmentRepo.save(shipment);
      for (const r of requests) {
        if (r.status !== CollectionRequestStatus.COMPLETED) {
          r.status = CollectionRequestStatus.COMPLETED;
          r.completedAt = now;
          r.deliveredAt = r.deliveredAt || now;
        }
      }
      if (requests.length) await this.requestRepo.save(requests);
    }

    return this.buildReceptionPayload(shipment, requests, warehouseBackendId);
  }

  /**
   * Shape the reception response: correlation ids, the driver/truck/weight
   * header, the AGGREGATED per-material lines (what reception/sorting/storage
   * work off) and the per-request breakdown (for the ADMIN only).
   */
  private async buildReceptionPayload(
    shipment: Shipment,
    requests: CollectionRequest[],
    warehouseBackendId: string,
  ) {
    // Resolve backend product uuid → Odoo product id (the sort sheet keys on it).
    const productIds = [
      ...new Set(
        requests.flatMap((r) => (r.lines || []).map((l) => l.productId)),
      ),
    ];
    const products = productIds.length
      ? await this.productRepo.find({ where: { id: In(productIds) } })
      : [];
    const odooByProduct = new Map(
      products.map((p) => [p.id, p.odooProductId ?? null]),
    );

    // AGGREGATE per material — the totals reception/sorting/storage work off.
    const agg = new Map<
      string,
      { odoo_product_id: number | null; product_name: string; unit: string; quantity: number }
    >();
    for (const r of requests) {
      for (const l of r.lines || []) {
        const qty = Number(l.actualQuantity ?? l.quantity) || 0;
        const cur = agg.get(l.productId);
        if (cur) cur.quantity += qty;
        else
          agg.set(l.productId, {
            odoo_product_id: odooByProduct.get(l.productId) ?? null,
            product_name: l.productName,
            unit: l.unitType,
            quantity: qty,
          });
      }
    }

    const totalWeight = requests.reduce(
      (s, r) => s + (parseFloat(r.actualWeightKg || r.estimatedWeightKg) || 0),
      0,
    );

    return {
      // Correlation + the values Odoo's `backend_upsert_shipment` consumes.
      backend_shipment_id: shipment.id,
      warehouse_backend_id: warehouseBackendId,
      shipment_number: shipment.shipmentNumber,
      status: shipment.status,
      driver_name: shipment.driver?.account?.name ?? null,
      truck_info: shipment.truck?.plateNumber ?? null,
      dispatch_date: shipment.departedAt ? shipment.departedAt.toISOString() : null,
      total_weight_kg: +totalWeight.toFixed(3),
      // Materials + quantities + unit — reception shows these; Odoo maps the
      // priced ones to `expected_line_ids`.
      expected_lines: [...agg.values()].map((m) => ({
        odoo_product_id: m.odoo_product_id,
        product_name: m.product_name,
        unit: m.unit,
        quantity: +m.quantity.toFixed(3),
      })),
      // Per-request breakdown — for the ADMIN only; the reception/sorting ignore it.
      requests: requests.map((r) => ({
        request_number: r.requestNumber,
        lines: (r.lines || []).map((l) => ({
          product_name: l.productName,
          quantity: Number(l.actualQuantity ?? l.quantity) || 0,
          unit: l.unitType,
        })),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Driver: cancel
  // ---------------------------------------------------------------------------
  async cancel(accountId: string, shipmentId: string) {
    const driver = await this.getDriver(accountId);
    const shipment = await this.getOwned(shipmentId, driver.id);
    this.guardTransition(shipment.status, ShipmentStatus.CANCELLED);

    shipment.status = ShipmentStatus.CANCELLED;
    await this.shipmentRepo.save(shipment);

    // Unlink requests back to PICKING
    const requests = await this.requestRepo.find({
      where: { shipmentId: shipment.id },
    });
    for (const r of requests) {
      r.status = CollectionRequestStatus.PICKING;
      r.shipmentId = null as any;
    }
    await this.requestRepo.save(requests);

    return this.serialize(shipment);
  }

  // ---------------------------------------------------------------------------
  // Public — no auth required
  // ---------------------------------------------------------------------------

  /** Public shipment detail: lookup by ID only (no owner check). */
  async publicDetail(shipmentId: string) {
    const shipment = await this.shipmentRepo.findOne({
      where: { id: shipmentId },
      relations: ['warehouse', 'requests'],
    });
    if (!shipment) throw new NotFoundException('Shipment not found');

    const requests = await this.requestRepo.find({
      where: { shipmentId: shipment.id },
      relations: ['lines'],
      order: { routeSequence: 'ASC' },
    });

    return {
      ...this.serialize(shipment),
      requests: requests.map((r) => ({
        id: r.id,
        request_number: r.requestNumber,
        status: r.status,
        route_sequence: r.routeSequence,
        actual_weight_kg: r.actualWeightKg,
        estimated_weight_kg: r.estimatedWeightKg,
        lines: (r.lines || []).map((l) => ({
          product_name: l.productName,
          quantity: l.quantity,
          unit_type: l.unitType,
        })),
      })),
    };
  }

  /**
   * Driver deliver: IN_TRANSIT → DELIVERED, owner-checked — a driver may only
   * drop off his OWN shipment, never another driver's.
   */
  async deliver(
    accountId: string,
    shipmentId: string,
    dto: DeliverShipmentDto,
  ) {
    const driver = await this.getDriver(accountId);
    const shipment = await this.getOwned(shipmentId, driver.id);
    return this.performDeliver(shipment, dto);
  }

  private async performDeliver(
    shipment: Shipment,
    dto: DeliverShipmentDto,
  ) {
    this.guardTransition(shipment.status, ShipmentStatus.DELIVERED);

    const now = new Date();

    if (!shipment.warehouseId && dto.warehouseId) {
      shipment.warehouseId = dto.warehouseId;
    }

    const requests = await this.requestRepo.find({
      where: { shipmentId: shipment.id },
    });

    shipment.status = ShipmentStatus.DELIVERED;
    shipment.deliveredAt = now;
    shipment.totalRequests = requests.length;
    shipment.totalWeightKg = String(
      requests.reduce(
        (sum, r) => sum + (parseFloat(r.actualWeightKg || r.estimatedWeightKg) || 0),
        0,
      ),
    );
    if (dto.notes) shipment.notes = dto.notes;
    await this.shipmentRepo.save(shipment);

    for (const r of requests) {
      r.status = CollectionRequestStatus.COMPLETED;
      r.completedAt = now;
      r.deliveredAt = r.deliveredAt || now;
    }
    await this.requestRepo.save(requests);

    return this.serialize(shipment);
  }

  // ---------------------------------------------------------------------------
  // Admin: list all shipments
  // ---------------------------------------------------------------------------
  async adminList(filters: {
    status?: ShipmentStatus;
    driverId?: string;
    warehouseId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 100);

    const qb = this.shipmentRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.driver', 'driver')
      .leftJoinAndSelect('s.truck', 'truck')
      .leftJoinAndSelect('s.warehouse', 'warehouse');

    if (filters.status) qb.andWhere('s.status = :status', { status: filters.status });
    if (filters.driverId) qb.andWhere('s.driverId = :driverId', { driverId: filters.driverId });
    if (filters.warehouseId) qb.andWhere('s.warehouseId = :warehouseId', { warehouseId: filters.warehouseId });

    qb.orderBy('s.createdAt', 'DESC');
    qb.skip((page - 1) * limit).take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items: items.map((s) => ({
        ...this.serialize(s),
        driver_name: s.driver?.['fullName'] || s.driver?.['account']?.['fullName'] || '',
        truck_plate: s.truck?.plateNumber || '',
        warehouse_name: s.warehouse?.name || '',
      })),
      total,
      page,
      limit,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: create shipment
  // ---------------------------------------------------------------------------
  private async createShipment(
    driverId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    firstRequest: CollectionRequest,
  ): Promise<Shipment> {
    const assignment = await this.assignmentRepo.findOne({
      where: { driverId },
      relations: ['truck'],
    });
    if (!assignment?.truck) {
      throw new BadRequestException('No truck assigned — cannot create shipment');
    }

    const warehouseId = await this.resolveWarehouseId(driverId);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');

    // Count-based sequencing collides whenever rows were ever deleted — probe
    // candidates until one is genuinely free instead of trusting the count.
    let shipmentNumber = '';
    let seq = await this.shipmentRepo.count();
    for (let i = 0; i < 25 && !shipmentNumber; i++) {
      seq += 1;
      const candidate = `SHP-${dateStr}-${String(seq).padStart(3, '0')}`;
      const taken = await this.shipmentRepo.findOne({
        where: { shipmentNumber: candidate },
        select: ['id'],
      });
      if (!taken) shipmentNumber = candidate;
    }
    if (!shipmentNumber) {
      throw new ConflictException('Could not allocate a unique shipment number');
    }

    const shipment = this.shipmentRepo.create({
      shipmentNumber,
      status: ShipmentStatus.CREATED,
      driverId,
      truckId: assignment.truck.id,
      warehouseId,
      totalWeightKg: '0',
      totalRequests: 0,
      collectedAt: now,
    });
    return this.shipmentRepo.save(shipment);
  }

  // ---------------------------------------------------------------------------
  // Internal: add request to shipment
  // ---------------------------------------------------------------------------
  private async addToShipment(
    shipment: Shipment,
    request: CollectionRequest,
  ): Promise<void> {
    request.shipmentId = shipment.id;
    await this.requestRepo.save(request);

    // Update totals
    const requests = await this.requestRepo.find({
      where: { shipmentId: shipment.id },
    });
    shipment.totalRequests = requests.length;
    shipment.totalWeightKg = String(
      requests.reduce(
        (sum, r) => sum + (parseFloat(r.actualWeightKg || r.estimatedWeightKg) || 0),
        0,
      ),
    );
    await this.shipmentRepo.save(shipment);
  }

  // ---------------------------------------------------------------------------
  // Internal: find active shipment for driver
  // ---------------------------------------------------------------------------
  private async activeShipment(driverId: string): Promise<Shipment | null> {
    return this.shipmentRepo.findOne({
      where: {
        driverId,
        status: In([ShipmentStatus.CREATED, ShipmentStatus.IN_TRANSIT]),
      },
      order: { createdAt: 'DESC' },
    });
  }

  // ---------------------------------------------------------------------------
  // Internal: resolve warehouse from handover
  // ---------------------------------------------------------------------------
  private async resolveWarehouseId(driverId: string): Promise<string | null> {
    const handover = await this.handoverRepo.findOne({
      where: { driverId, status: HandoverStatus.OPEN },
    });
    return handover?.warehouseId ?? null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private async getDriver(accountId: string) {
    const driver = await this.driverRepo.findOne({
      where: { account: { id: accountId } },
    });
    if (!driver) throw new NotFoundException('Driver profile not found');
    return driver;
  }

  private async getOwned(id: string, driverId: string) {
    const s = await this.shipmentRepo.findOne({ where: { id, driverId } });
    if (!s) throw new NotFoundException('Shipment not found');
    return s;
  }

  private guardTransition(from: ShipmentStatus, to: ShipmentStatus) {
    if (!canTransitionShipment(from, to)) {
      throw new ConflictException(
        `Cannot transition shipment from ${from} to ${to}`,
      );
    }
  }

  private serialize(s: Shipment) {
    return {
      id: s.id,
      shipment_number: s.shipmentNumber,
      status: s.status,
      total_weight_kg: parseFloat(s.totalWeightKg as any) || 0,
      total_requests: s.totalRequests,
      warehouse_id: s.warehouseId || null,
      notes: s.notes,
      collected_at: s.collectedAt,
      departed_at: s.departedAt,
      delivered_at: s.deliveredAt,
      created_at: s.createdAt,
    };
  }
}
