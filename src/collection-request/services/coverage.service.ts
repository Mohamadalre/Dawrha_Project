import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import Redis from 'ioredis';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { TruckStatus } from '@src/truck/enums/truck-status.enum';
import { HandoverStatus } from '@src/truck/enums/handover-status.enum';
import { TruckEntity } from '@src/truck/entities/truck.entity';
import { TruckHandover } from '@src/truck/entities/truck-handover.entity';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { CoveragePoint } from '../entities/coverage-point.entity';
import { DriverCoverageAssignment } from '../entities/driver-coverage-assignment.entity';
import { CollectionRequest } from '../entities/collection-request.entity';
import {
  CollectionRequestStatus,
} from '../enums/collection-request-status.enum';
import { minutesOfDayInZone } from '@src/common/time/operation-time.util';

/** Statuses on which a driver is busy and NOT parked at a coverage point. */
const BUSY_STATUSES: CollectionRequestStatus[] = [
  CollectionRequestStatus.EN_ROUTE,
  CollectionRequestStatus.ARRIVED,
  CollectionRequestStatus.PICKING,
];

/**
 * Coverage v1: park idle drivers on coverage points (schools, markets,
 * hospitals) so a request finds them scattered rather than clustered.
 *
 * Distribution is greedy — each eligible driver goes to the point with the
 * fewest parked drivers, ties broken by point priority. Re-running is a
 * full re-distribution (idempotent by the unique driverId row); a driver who
 * already sits at the best point is simply left where he is.
 *
 * The live location for scoring still wins over the point (the engine falls
 * back to the point only when no truck fix exists), so coverage is about
 * STARTING positions, not constraints.
 */
@Injectable()
export class CoverageService {
  private readonly logger = new Logger('COVERAGE');

  /** Short-lived cache so concurrent/rapid nearby calls share one computation. */
  private readonly zoneCache = new Map<string, { at: number; data: any[] }>();
  private readonly ZONE_CACHE_TTL_MS = 2000;

  constructor(
    @InjectRepository(CoveragePoint)
    private readonly pointRepo: Repository<CoveragePoint>,
    @InjectRepository(DriverCoverageAssignment)
    private readonly assignmentRepo: Repository<DriverCoverageAssignment>,
    @InjectRepository(TruckHandover)
    private readonly handoverRepo: Repository<TruckHandover>,
    @InjectRepository(CollectionRequest)
    private readonly requestRepo: Repository<CollectionRequest>,
    @InjectRepository(TruckAssignmentEntity)
    private readonly truckAssignmentRepo: Repository<TruckAssignmentEntity>,
    @InjectRepository(CollectorProfile)
    private readonly profileRepo: Repository<CollectorProfile>,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  /** Re-distributes every eligible idle driver onto the best point. */
  async distributeIdleDrivers(): Promise<number> {
    const points = await this.pointRepo.find({
      where: { isActive: true },
      order: { priority: 'DESC' },
    });
    if (!points.length) return 0;

    const driverIds = await this.eligibleIdleDriverIds();
    if (!driverIds.length) return 0;

    const current = await this.assignmentRepo.find();
    const load = new Map<string, number>();
    for (const point of points) load.set(point.id, 0);
    for (const row of current) {
      if (row.coveragePointId && load.has(row.coveragePointId)) {
        load.set(row.coveragePointId, (load.get(row.coveragePointId) ?? 0) + 1);
      }
    }

    const existingByDriver = new Map(
      current.filter((c) => c.isActive).map((c) => [c.driverId, c]),
    );

    let moved = 0;
    for (const driverId of driverIds) {
      const best = [...points].sort(
        (a, b) =>
          (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) ||
          b.priority - a.priority,
      )[0];
      load.set(best.id, (load.get(best.id) ?? 0) + 1);

      const existing = existingByDriver.get(driverId);
      if (existing && existing.coveragePointId === best.id) continue;

      await this.assignmentRepo.save(
        this.assignmentRepo.create({
          id: existing?.id,
          driverId,
          coveragePointId: best.id,
          assignedFrom: new Date(),
          isActive: true,
        }),
      );
      moved++;
    }

    if (moved) this.logger.log(`Distributed ${moved} driver(s) to coverage points`);
    return moved;
  }

  /** Moves ONE driver to the least-loaded point (e.g. after he finishes a task). */
  async relocate(driverId: string): Promise<DriverCoverageAssignment | null> {
    const points = await this.pointRepo.find({
      where: { isActive: true },
      order: { priority: 'DESC' },
    });
    if (!points.length) return null;

    const current = await this.assignmentRepo.find();
    const load = new Map<string, number>();
    for (const point of points) load.set(point.id, 0);
    for (const row of current) {
      if (row.coveragePointId && load.has(row.coveragePointId)) {
        load.set(row.coveragePointId, (load.get(row.coveragePointId) ?? 0) + 1);
      }
    }

    const best = [...points].sort(
      (a, b) =>
        (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) ||
        b.priority - a.priority,
    )[0];

    return this.assignmentRepo.save(
      this.assignmentRepo.create({
        driverId,
        coveragePointId: best.id,
        assignedFrom: new Date(),
        isActive: true,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // User-facing: nearby zones
  // ---------------------------------------------------------------------------

  /** Radius (meters) used to sweep live GPS drivers around a coverage point. */
  private readonly GPS_FALLBACK_RADIUS_M = 5000;

  async findNearbyZones(
    lat: number,
    lng: number,
    radiusKm: number = 10,
  ): Promise<any[]> {
    const cacheKey = `${Number(lat).toFixed(3)}:${Number(lng).toFixed(3)}:${radiusKm}`;
    const cached = this.zoneCache.get(cacheKey);
    if (cached && Date.now() - cached.at < this.ZONE_CACHE_TTL_MS) return cached.data;

    const points = await this.pointRepo.find({ where: { isActive: true } });

    const withDistance = points
      .map((p) => ({
        ...p,
        distance_km: this.haversineKm(lat, lng, Number(p.lat), Number(p.lng)),
      }))
      .filter((p) => p.distance_km <= radiusKm)
      .sort((a, b) => a.distance_km - b.distance_km || b.priority - a.priority);

    if (!withDistance.length) {
      const empty: any[] = [];
      this.zoneCache.set(cacheKey, { at: Date.now(), data: empty });
      return empty;
    }

    // Candidate pool: every eligible on-duty driver (parked OR just passing by).
    const eligibleIds = await this.eligibleIdleDriverIds();
    const profiles = eligibleIds.length
      ? await this.profileRepo.find({
          where: { id: In(eligibleIds) },
          relations: ['account', 'shift', 'assignment', 'assignment.truck'],
        })
      : [];

    // Live GPS positions keyed by truckId.
    const profilesByTruck = new Map<string, CollectorProfile>();
    const truckIds: string[] = [];
    for (const p of profiles) {
      const tid = p.assignment?.truck?.id;
      if (tid) {
        profilesByTruck.set(tid, p);
        truckIds.push(tid);
      }
    }
    const locValues = truckIds.length
      ? await this.redis.mget(truckIds.map((id) => `truck:location:${id}`))
      : [];
    const locByTruck = new Map<string, { lat: number; lng: number }>();
    truckIds.forEach((id, i) => {
      const raw = locValues[i];
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as { lat?: number; lng?: number };
        if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
          locByTruck.set(id, { lat: parsed.lat, lng: parsed.lng });
        }
      } catch {
        // A corrupt frame must not sink the lookup — ignore it.
      }
    });

    // Official "parked at point" assignments for the nearby points.
    const assignments = await this.assignmentRepo.find({
      where: withDistance.map((p) => ({ coveragePointId: p.id, isActive: true })),
      relations: ['driver', 'driver.account', 'driver.shift', 'driver.assignment', 'driver.assignment.truck'],
    });

    const routeWeightMap = await this.activeRouteWeights(eligibleIds);
    const now = new Date();
    const result: any[] = [];

    for (const point of withDistance) {
      const pointAssignments = assignments.filter((a) => a.coveragePointId === point.id);
      const drivers: any[] = [];
      const addedDriverIds = new Set<string>();

      // 1) Primary: drivers officially parked at this point.
      for (const a of pointAssignments) {
        const profile = a.driver;
        if (!profile?.assignment?.truck) continue;
        const truck = profile.assignment.truck;
        if (truck.status === TruckStatus.DISABLED) continue;
        drivers.push(this.enrichDriver(profile, truck, routeWeightMap, now, a.assignedFrom, 'assigned'));
        addedDriverIds.add(profile.id);
      }

      // 2) Fallback: eligible drivers within GPS radius of the point.
      const radiusM = Math.max(Number(point.radiusM) || 0, this.GPS_FALLBACK_RADIUS_M);
      for (const [tid, profile] of profilesByTruck) {
        if (addedDriverIds.has(profile.id)) continue;
        const loc = locByTruck.get(tid);
        if (!loc) continue;
        const distKm = this.haversineKm(Number(point.lat), Number(point.lng), loc.lat, loc.lng);
        if (distKm * 1000 > radiusM) continue;
        const truck = profile.assignment?.truck;
        if (!truck || truck.status === TruckStatus.DISABLED) continue;
        drivers.push(this.enrichDriver(profile, truck, routeWeightMap, now, null, 'gps'));
        addedDriverIds.add(profile.id);
      }

      result.push({
        point_id: point.id,
        name: point.name,
        point_type: point.pointType,
        lat: Number(point.lat),
        lng: Number(point.lng),
        distance_km: +point.distance_km.toFixed(2),
        available_drivers: drivers.length,
        drivers_with_capacity: drivers.filter((d) => d.remaining_kg > 0).length,
        remaining_capacity_kg: drivers.reduce((s, d) => s + d.remaining_kg, 0),
        drivers,
      });
    }

    this.zoneCache.set(cacheKey, { at: Date.now(), data: result });
    return result;
  }

  private enrichDriver(
    profile: CollectorProfile,
    truck: TruckEntity,
    routeWeightMap: Map<string, number>,
    now: Date,
    parkedSince: Date | null,
    source: 'assigned' | 'gps',
  ): any {
    const maxKg = Number(truck.maxPayloadKg) || 0;
    const usedKg = routeWeightMap.get(profile.id) || 0;
    const remainingKg = Math.max(0, maxKg - usedKg);

    const shift = profile.shift;
    let shiftRemainingMinutes = 0;
    if (shift) {
      shiftRemainingMinutes = this.shiftRemainingMinutes(shift.startTime, shift.endTime, now);
    }

    return {
      driver_id: profile.id,
      driver_name: profile.account?.name ?? null,
      truck_plate: truck.plateNumber,
      truck_id: truck.id,
      max_payload_kg: maxKg,
      remaining_kg: +remainingKg.toFixed(2),
      remaining_shift_minutes: shiftRemainingMinutes,
      parked_since: parkedSince,
      source,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  /** Drivers who are ACTIVE, hold an open truck handover, on a live shift and not mid-pickup. */
  private async eligibleIdleDriverIds(): Promise<string[]> {
    const rows = await this.handoverRepo
      .createQueryBuilder('h')
      .innerJoin('h.driver', 'cp')
      .innerJoin('cp.account', 'account')
      .innerJoin('cp.shift', 'shift')
      .innerJoin('cp.assignment', 'assignment')
      .innerJoin('assignment.truck', 'truck')
      .select('cp.id', 'driverId')
      .distinct(true)
      .addSelect('shift.startTime', 'startTime')
      .addSelect('shift.endTime', 'endTime')
      .where('h.status = :open', { open: HandoverStatus.OPEN })
      .andWhere('account.accountStatus = :active', {
        active: AccountStatus.ACTIVE,
      })
      .andWhere('shift.isActive = true')
      .andWhere('truck.status != :disabled', { disabled: TruckStatus.DISABLED })
      .getRawMany<{ driverId: string; startTime: string; endTime: string }>();

    const now = new Date();
    const onShift = rows.filter((r) =>
      this.shiftCovers(r.startTime, r.endTime, now),
    );
    if (!onShift.length) return [];

    const driverIds = onShift.map((r) => r.driverId);
    const busyRows = await this.requestRepo
      .createQueryBuilder('r')
      .innerJoin('r.route', 'route')
      .select('DISTINCT route.driverId', 'driverId')
      .where('r.status IN (:...statuses)', { statuses: BUSY_STATUSES })
      .andWhere('route.driverId IN (:...driverIds)', { driverIds })
      .getRawMany<{ driverId: string }>();
    const busy = new Set(busyRows.map((r) => r.driverId));

    return onShift.filter((r) => !busy.has(r.driverId)).map((r) => r.driverId);
  }

  private shiftCovers(startTime: string, endTime: string, now: Date): boolean {
    const toMin = (t: string): number => {
      const [, h, m, s] = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t) ?? [];
      return Number(h) * 60 + Number(m) + (s ? Number(s) / 60 : 0);
    };
    const start = toMin(startTime);
    const end = toMin(endTime);
    // Minutes-of-day in the OPERATION timezone (shift times are Damascus
    // wall-clock) — not the server's, which on UTC would drift the decision.
    const current = minutesOfDayInZone(now);

    if (start === end) return true;
    return start < end
      ? current >= start && current < end
      : current >= start || current < end;
  }

  private shiftRemainingMinutes(startTime: string, endTime: string, now: Date): number {
    const toMin = (t: string): number => {
      const [, h, m, s] = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t) ?? [];
      return Number(h) * 60 + Number(m) + (s ? Number(s) / 60 : 0);
    };
    const start = toMin(startTime);
    const end = toMin(endTime);
    // Minutes-of-day in the OPERATION timezone (see shiftCovers above).
    const current = minutesOfDayInZone(now);

    if (start === end) return 24 * 60;
    if (start < end) {
      return Math.max(0, end - current);
    }
    const tonight = 24 * 60 - start;
    return Math.max(0, tonight + end - current);
  }

  private haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private async activeRouteWeights(driverIds: string[]): Promise<Map<string, number>> {
    if (!driverIds.length) return new Map();
    const rows = await this.requestRepo
      .createQueryBuilder('r')
      .innerJoin('r.route', 'route')
      .select('route.driverId', 'driverId')
      .addSelect(
        `COALESCE(SUM(CASE WHEN r."actual_weight_kg" IS NOT NULL THEN r."actual_weight_kg" ELSE r."estimated_weight_kg" END), 0)`,
        'weight',
      )
      .where('r.status IN (:...statuses)', {
        statuses: [CollectionRequestStatus.ASSIGNED, CollectionRequestStatus.EN_ROUTE, CollectionRequestStatus.ARRIVED, CollectionRequestStatus.PICKING],
      })
      .andWhere('route.driverId IN (:...driverIds)', { driverIds })
      .groupBy('route.driverId')
      .getRawMany<{ driverId: string; weight: string }>();
    return new Map(rows.map((r) => [r.driverId, Number(r.weight)]));
  }
}