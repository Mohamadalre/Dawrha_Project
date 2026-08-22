import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
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
import { ShipmentStatus } from '../enums/shipment-status.enum';
import {
  CollectionRequestStatus,
} from '../enums/collection-request-status.enum';
import {
  canTransitionShipment,
} from '../enums/shipment-status.enum';
import { DeliverShipmentDto } from '../dto/shipment.dto';

const LOG_META = { context: 'SHIPMENT_SERVICE', channel: 'collection' } as const;

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
  // Driver: deliver (IN_TRANSIT → DELIVERED)
  // ---------------------------------------------------------------------------
  async deliver(accountId: string, shipmentId: string, dto: DeliverShipmentDto) {
    const driver = await this.getDriver(accountId);
    const shipment = await this.getOwned(shipmentId, driver.id);
    this.guardTransition(shipment.status, ShipmentStatus.DELIVERED);

    const now = new Date();

    // Resolve warehouse if not set
    if (!shipment.warehouseId) {
      const warehouseId = await this.resolveWarehouseId(driver.id);
      if (warehouseId) {
        shipment.warehouseId = warehouseId;
      }
    }

    // Recalculate totals
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

    // Mark all linked requests as COMPLETED
    for (const r of requests) {
      r.status = CollectionRequestStatus.COMPLETED;
      r.completedAt = now;
      r.deliveredAt = r.deliveredAt || now;
    }
    await this.requestRepo.save(requests);

    return this.serialize(shipment);
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
    const count = await this.shipmentRepo.count();
    const seq = String(count + 1).padStart(3, '0');
    const shipmentNumber = `SHP-${dateStr}-${seq}`;

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
