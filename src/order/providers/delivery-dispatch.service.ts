import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { OdooService } from '@src/odoo/odoo.service';
import { DeliveryTrip } from '../entities/delivery-trip.entity';
import { DeliveryTripStatus } from '../enums/delivery-trip-status.enum';
import { ScorableTruck, scoreTrucks } from './truck-score';

/** How far back "recent trips" reaches when balancing the fleet. */
const FAIRNESS_WINDOW_DAYS = 14;

/**
 * Which truck runs a delivery trip.
 *
 * The rules the business gave — active, not busy, big enough, and NOT always the
 * same vehicle — split cleanly into two jobs, and this service owns the first:
 * gather the trucks that MAY run from a warehouse and rank them by the score.
 * The second job (packing a load into them) is the capacity planner's, and
 * keeping them apart is what lets each be tested on its own.
 *
 * A truck is a candidate only if it is a DELIVERY truck OF THIS WAREHOUSE, the
 * admin has it ACTIVE (not disabled), and it is not already out on a live trip.
 *
 * DELIVERY TRUCKS ARE NOT MIRRORED in the backend — Odoo owns and manages them,
 * and only COLLECTION trucks live in the local fleet table. So the candidate
 * list is read LIVE from Odoo at plan time. The two signals that DO belong to
 * the backend — "busy" and "recently used" — are still derived from the
 * backend's own delivery-trip rows, which are keyed by the Odoo truck id.
 */
@Injectable()
export class DeliveryDispatchService {
  private readonly logger = new Logger('DELIVERY_DISPATCH');

  constructor(
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    @InjectRepository(DeliveryTrip)
    private readonly tripRepo: Repository<DeliveryTrip>,
    private readonly odoo: OdooService,
  ) {}

  /**
   * The warehouse's delivery trucks that may run right now, best first.
   *
   * Returns the scored list rather than a single pick so the caller can take the
   * top one AND, if a second trip sets out from the same warehouse, take the
   * next without re-querying.
   */
  async rankTrucksForWarehouse(
    warehouseId: string,
    requiredKg?: number,
  ): Promise<Array<ScorableTruck & { odooTruckId: number; score: number; fits: boolean; hasAvailableDriver: boolean }>> {
    // Resolve the backend warehouse to its Odoo id — the delivery fleet is
    // keyed by Odoo warehouse, and a warehouse never synced to Odoo has none.
    const warehouse = await this.warehouseRepo.findOne({ where: { id: warehouseId } });
    if (!warehouse?.odooWarehouseId) return [];

    // Live Odoo read. If Odoo is unreachable, degrade to "no eligible truck"
    // rather than failing the whole delivery plan: the trip service already
    // leaves a truckless trip PLANNED for a human (or a later re-plan) to assign,
    // which is a far better outcome than a checkout that cannot be completed.
    let odooTrucks: any[];
    try {
      odooTrucks = await this.odoo.fetchDeliveryTrucksForWarehouse(warehouse.odooWarehouseId);
    } catch (err) {
      this.logger.warn(
        `Could not read delivery trucks for warehouse ${warehouseId} from Odoo: ${(err as Error).message}`,
      );
      return [];
    }
    const usable = (odooTrucks ?? []).filter((t) => t?.id != null);
    if (!usable.length) return [];

    const odooIds = usable.map((t) => Number(t.id));
    const busy = await this.busyTruckIds(odooIds);
    const recent = await this.recentTripCounts(odooIds);

    const freeIds = odooIds.filter((id) => !busy.has(id));
    // Which of the free trucks can actually run — an available driver in Odoo.
    // Best-effort: if Odoo cannot answer, treat availability as unknown (every
    // truck stays a candidate) rather than blocking the plan.
    let driverIds = new Set<number>();
    try {
      driverIds = new Set(await this.odoo.fetchTrucksWithAvailableDriver(freeIds));
    } catch (err) {
      this.logger.warn(
        `Could not read driver availability from Odoo: ${(err as Error).message}`,
      );
    }
    const driverKnown = driverIds.size > 0;

    const candidates: ScorableTruck[] = usable
      .filter((t) => !busy.has(Number(t.id)))
      .map((t) => ({
        odooTruckId: Number(t.id),
        maxPayloadKg: Number(t.max_payload_kg ?? 0),
        recentTripCount: recent.get(Number(t.id)) ?? 0,
        // Undefined (unknown) when Odoo could not answer, so the scorer keeps
        // the plain ordering; otherwise true only for trucks that have a driver.
        hasAvailableDriver: driverKnown ? driverIds.has(Number(t.id)) : undefined,
      }));
    if (!candidates.length) return [];

    const ranked = scoreTrucks(candidates, { requiredKg });
    const byId = new Map(candidates.map((c) => [c.odooTruckId, c]));
    return ranked.map((r) => ({
      ...(byId.get(r.odooTruckId) as ScorableTruck),
      score: r.score,
      fits: r.fits,
      hasAvailableDriver: r.hasAvailableDriver,
    }));
  }

  /** Trucks currently out on an assigned or in-progress trip. */
  private async busyTruckIds(odooIds: number[]): Promise<Set<number>> {
    const live = await this.tripRepo.find({
      where: {
        odooTruckId: In(odooIds),
        status: In([DeliveryTripStatus.ASSIGNED, DeliveryTripStatus.IN_PROGRESS]),
      },
      select: ['odooTruckId'],
    });
    return new Set(live.map((t) => t.odooTruckId as number));
  }

  /** Trips per truck inside the fairness window — the rotation signal. */
  private async recentTripCounts(
    odooIds: number[],
  ): Promise<Map<number, number>> {
    const since = new Date(Date.now() - FAIRNESS_WINDOW_DAYS * 86_400_000);
    const rows = await this.tripRepo
      .createQueryBuilder('t')
      .select('t.odoo_truck_id', 'truck')
      .addSelect('COUNT(*)', 'count')
      .where('t.odoo_truck_id IN (:...odooIds)', { odooIds })
      .andWhere('t.created_at >= :since', { since })
      .groupBy('t.odoo_truck_id')
      .getRawMany<{ truck: number; count: string }>();
    return new Map(rows.map((r) => [Number(r.truck), Number(r.count)]));
  }
}
