import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Product } from '@src/waste-management/entities/product.entity';
import { UnitsService } from '@src/waste-management/common/providers/units.service';
import { EffectivePriceService } from '@src/waste-management/common/providers/effective-price.service';
import { ProductNotFoundException } from '@src/waste-management/exceptions/waste.exceptions';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { CollectionRequest } from '../entities/collection-request.entity';
import { CollectionRequestLine } from '../entities/collection-request-line.entity';
import { CollectionRoute } from '../entities/collection-route.entity';
import { DriverCoverageAssignment } from '../entities/driver-coverage-assignment.entity';
import { CoveragePoint } from '../entities/coverage-point.entity';
import { ShipmentService } from './shipment.service';
import { CollectionRequestType } from '../enums/collection-request-type.enum';
import { CollectionRequestStatus } from '../enums/collection-request-status.enum';
import { CollectionRouteStatus } from '../enums/collection-route-status.enum';
import { estimateWeightKg } from '../utils/weight.util';
import { nextSequentialNumber } from '../utils/sequence.util';
import { winstonLogger } from '@src/core/logger-config/winston.config';

const LOG_META = { context: 'DROP_OFF', channel: 'collection' } as const;

@Injectable()
export class DropOffService {
  constructor(
    @InjectRepository(CollectionRequest)
    private readonly requestRepo: Repository<CollectionRequest>,
    @InjectRepository(CollectionRequestLine)
    private readonly lineRepo: Repository<CollectionRequestLine>,
    @InjectRepository(CollectionRoute)
    private readonly routeRepo: Repository<CollectionRoute>,
    @InjectRepository(DriverCoverageAssignment)
    private readonly coverageRepo: Repository<DriverCoverageAssignment>,
    @InjectRepository(CoveragePoint)
    private readonly pointRepo: Repository<CoveragePoint>,
    @InjectRepository(CollectorProfile)
    private readonly profileRepo: Repository<CollectorProfile>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly units: UnitsService,
    private readonly effectivePrice: EffectivePriceService,
    private readonly shipmentService: ShipmentService,
  ) {}

  async createDropOff(
    accountId: string,
    dto: { driver_id: string; coverage_point_id: string; lines: { product_id: string; quantity: number }[] },
  ) {
    if (!dto.lines?.length) throw new BadRequestException('At least one line is required');

    const assignment = await this.coverageRepo.findOne({
      where: { driverId: dto.driver_id, coveragePointId: dto.coverage_point_id, isActive: true },
      relations: ['driver', 'driver.account', 'driver.shift', 'driver.assignment', 'driver.assignment.truck', 'coveragePoint'],
    });
    if (!assignment) throw new BadRequestException('Driver is not stationed at this coverage point');

    const profile = assignment.driver;
    const truck = profile?.assignment?.truck;
    if (!truck) throw new BadRequestException('Driver has no truck assigned');

    const productIds = dto.lines.map((l) => l.product_id);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException('Duplicate products in lines');
    }
    const products = await this.productRepo.find({ where: { id: In(productIds), isActive: true } });
    const productMap = new Map(products.map((p) => [p.id, p]));
    const weightCodes = await this.units.weightCodes();

    interface LineData {
      productId: string;
      productName: string;
      unitType: string;
      quantity: string;
      actualQuantity: string;
      unitPrice: string;
      total: string;
      note: null;
    }
    let estimatedWeightKg = 0;
    let estimatedGrandTotal = 0;
    const buildableLines: LineData[] = [];

    for (const line of dto.lines) {
      const product = productMap.get(line.product_id);
      if (!product) throw new ProductNotFoundException();

      const effective = await this.effectivePrice.effectivePrice(product.id, profile.account.role, null);
      if (!effective) throw new BadRequestException('No price for this material');

      const unitPrice = Number(effective.price);
      const total = +(unitPrice * line.quantity).toFixed(3);
      const weightKg = estimateWeightKg(product, line.quantity, weightCodes);
      estimatedWeightKg += weightKg;
      estimatedGrandTotal += total;

      buildableLines.push({
        productId: product.id,
        productName: product.name,
        unitType: product.unitType,
        quantity: String(line.quantity),
        actualQuantity: String(line.quantity),
        unitPrice: String(unitPrice),
        total: String(total),
        note: null,
      });
    }

    const maxKg = Number(truck.maxPayloadKg) || 0;
    const currentWeight = await this.driverCurrentWeight(dto.driver_id);
    const remainingKg = maxKg - currentWeight;
    if (remainingKg < estimatedWeightKg) {
      throw new BadRequestException(`Insufficient capacity. Remaining: ${remainingKg.toFixed(1)}kg, required: ${estimatedWeightKg.toFixed(1)}kg`);
    }

    let route = await this.routeRepo.findOne({
      where: { driverId: dto.driver_id, status: In([CollectionRouteStatus.PLANNED, CollectionRouteStatus.IN_PROGRESS]) },
      order: { createdAt: 'ASC' },
    });
    if (!route) {
      route = this.routeRepo.create({
        routeNumber: await nextSequentialNumber(this.routeRepo, 'routeNumber', 'RT', 3),
        driverId: dto.driver_id,
        status: CollectionRouteStatus.IN_PROGRESS,
        startedAt: new Date(),
      });
      route = await this.routeRepo.save(route);
    }

    const requestNumber = await nextSequentialNumber(this.requestRepo, 'requestNumber', this.requestPrefix(), 5);

    const request = this.requestRepo.create({
      requestNumber,
      accountId,
      type: CollectionRequestType.WALK_IN,
      status: CollectionRequestStatus.PICKING,
      estimatedWeightKg: String(+estimatedWeightKg.toFixed(3)),
      estimatedGrandTotal: String(+estimatedGrandTotal.toFixed(3)),
      actualWeightKg: String(+estimatedWeightKg.toFixed(3)),
      actualGrandTotal: String(+estimatedGrandTotal.toFixed(3)),
      routeId: route.id,
      routeSequence: (await this.routeStopCount(route.id)) + 1,
      pickedAt: new Date(),
      lat: assignment.coveragePoint ? String(assignment.coveragePoint.lat) : null,
      lng: assignment.coveragePoint ? String(assignment.coveragePoint.lng) : null,
      addressText: assignment.coveragePoint?.name ?? null,
    });

    const saved = await this.requestRepo.save(request);

    const lineEntities: CollectionRequestLine[] = buildableLines.map((l) =>
      this.lineRepo.create({ ...l, requestId: saved.id }),
    );
    await this.lineRepo.save(lineEntities);
    await this.shipmentService.autoCreateOrAddToShipment(dto.driver_id, saved);

    winstonLogger.info(`WALK-IN ${saved.requestNumber}: driver ${dto.driver_id}, ${estimatedWeightKg.toFixed(1)}kg`, LOG_META);

    const truckCapacity = await this.getTruckCapacity(dto.driver_id);

    return {
      request_id: saved.id,
      request_number: saved.requestNumber,
      status: saved.status,
      type: saved.type,
      actual_weight_kg: +estimatedWeightKg.toFixed(2),
      actual_grand_total: +estimatedGrandTotal.toFixed(2),
      driver_name: profile.account?.name ?? null,
      truck_plate: truck.plateNumber,
      route_id: route.id,
      lines: buildableLines.map((l) => ({
        product_id: l.productId,
        product_name: l.productName,
        quantity: Number(l.quantity),
        actual_quantity: Number(l.actualQuantity),
        unit_price: Number(l.unitPrice),
        total: Number(l.total),
      })),
      truck_capacity: truckCapacity,
    };
  }

  async getDriverQR(driverId: string) {
    const profile = await this.profileRepo.findOne({
      where: { id: driverId },
      relations: ['account', 'assignment', 'assignment.truck'],
    });
    if (!profile) throw new NotFoundException('Driver not found');

    const assignment = await this.coverageRepo.findOne({
      where: { driverId, isActive: true },
      relations: ['coveragePoint'],
    });

    const truck = profile.assignment?.truck;

    return {
      driver_id: profile.id,
      driver_name: profile.account?.name ?? null,
      account_id: profile.account?.id ?? null,
      truck_plate: truck?.plateNumber ?? null,
      truck_id: truck?.id ?? null,
      coverage_point: assignment?.coveragePoint?.name ?? null,
      coverage_point_id: assignment?.coveragePointId ?? null,
      qr_data: `DAWRHA-DRIVER:${profile.id}`,
    };
  }

  private requestPrefix(): string {
    const now = new Date();
    return `CR-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private async routeStopCount(routeId: string): Promise<number> {
    return this.requestRepo.count({ where: { routeId } });
  }

  private async driverCurrentWeight(driverId: string): Promise<number> {
    const rows = await this.requestRepo
      .createQueryBuilder('r')
      .innerJoin('r.route', 'route')
      .select(
        `COALESCE(SUM(CASE WHEN r."actual_weight_kg" IS NOT NULL THEN r."actual_weight_kg" ELSE r."estimated_weight_kg" END), 0)`,
        'weight',
      )
      .where('r.status IN (:...statuses)', {
        statuses: [CollectionRequestStatus.ASSIGNED, CollectionRequestStatus.EN_ROUTE, CollectionRequestStatus.ARRIVED, CollectionRequestStatus.PICKING],
      })
      .andWhere('route.driverId = :driverId', { driverId })
      .getRawOne<{ weight: string }>();
    return Number(rows?.weight ?? 0);
  }

  private async getTruckCapacity(driverId: string) {
    const profile = await this.profileRepo.findOne({
      where: { id: driverId },
      relations: ['assignment', 'assignment.truck'],
    });
    const truck = profile?.assignment?.truck;
    if (!truck?.maxPayloadKg) return null;

    const maxKg = Number(truck.maxPayloadKg);
    const usedKg = await this.driverCurrentWeight(driverId);
    const remaining = Math.max(0, maxKg - usedKg);
    return {
      max_kg: maxKg,
      used_kg: +usedKg.toFixed(2),
      remaining_kg: +remaining.toFixed(2),
      is_full: remaining <= 0,
    };
  }
}
