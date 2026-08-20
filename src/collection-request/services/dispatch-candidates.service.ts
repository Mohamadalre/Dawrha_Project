import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { TruckStatus } from '@src/truck/enums/truck-status.enum';
import { CollectionRequest } from '../entities/collection-request.entity';
import { DriverCoverageAssignment } from '../entities/driver-coverage-assignment.entity';
import { DispatchConfig } from '../entities/dispatch-config.entity';
import { CollectionRequestStatus } from '../enums/collection-request-status.enum';

/** The work-in-progress statuses that count as "load" and block a driver. */
const ACTIVE_TASK_STATUSES: CollectionRequestStatus[] = [
  CollectionRequestStatus.ASSIGNED,
  CollectionRequestStatus.EN_ROUTE,
  CollectionRequestStatus.ARRIVED,
  CollectionRequestStatus.PICKING,
];

/** Statuses on which a driver is considered busy and gets NO offer at all. */
const BUSY_STATUSES: CollectionRequestStatus[] = [
  CollectionRequestStatus.EN_ROUTE,
  CollectionRequestStatus.ARRIVED,
  CollectionRequestStatus.PICKING,
];

/** Fallback location when a driver has no live truck position yet. */
export interface FallbackLocation {
  lat: number;
  lng: number;
}

/** A driver who passed the hard filters, with his current context. */
export interface DriverCandidate {
  /** collector_profiles.id — the ledger's driverId. */
  driverId: string;
  /** accounts.id — the socket room and notification target. */
  accountId: string;
  truckId: string;
  maxPayloadKg: number | null;
  shiftStart: string;
  shiftEnd: string;
  /** Live tasks (ASSIGNED..PICKING) — the load factor and capacity basis. */
  activeTasks: number;
  activeWeightKg: number;
  /** COMPLETED requests today — the fairness factor. */
  completedToday: number;
  /** Where the driver is known to be when no truck fix exists. */
  fallbackLocation: FallbackLocation | null;
  /** Passed the weight-capacity gate for THIS request. */
  passesCapacity: boolean;
}

/**
 * Builds the candidate pool for an election: every driver who could legally
 * serve a request right now, with the per-driver workload context the scores
 * need. Scoring itself lives in the engine; this is pure eligibility + fact
 * gathering, so the "who is allowed" rule has exactly one home.
 *
 * Hard filters (from the design):
 *  - account ACTIVE
 *  - truck assigned and not DISABLED
 *  - active shift covering now
 *  - not mid-pickup (no EN_ROUTE/ARRIVED/PICKING request)
 *  - remaining payload capacity >= the request's estimated weight
 */
@Injectable()
export class DispatchCandidatesService {
  constructor(
    @InjectRepository(CollectorProfile)
    private readonly profileRepo: Repository<CollectorProfile>,
    @InjectRepository(CollectionRequest)
    private readonly requestRepo: Repository<CollectionRequest>,
    @InjectRepository(DriverCoverageAssignment)
    private readonly coverageRepo: Repository<DriverCoverageAssignment>,
  ) {}

  /**
   * All drivers eligible to serve `request` right now, optionally restricted to
   * a given driver (for the per-driver "he moved, re-elect" trigger).
   */
  async findEligible(
    request: CollectionRequest,
    config: DispatchConfig,
    driverIds?: string[],
  ): Promise<DriverCandidate[]> {
    const now = new Date();

    const qb = this.profileRepo
      .createQueryBuilder('cp')
      .innerJoinAndSelect('cp.account', 'account')
      .innerJoinAndSelect('cp.shift', 'shift')
      .innerJoin('cp.assignment', 'assignment')
      .innerJoinAndSelect('assignment.truck', 'truck')
      .where('account.accountStatus = :active', {
        active: AccountStatus.ACTIVE,
      })
      .andWhere('shift.isActive = true')
      .andWhere('truck.status != :disabled', {
        disabled: TruckStatus.DISABLED,
      });

    if (driverIds?.length) {
      qb.andWhere('cp.id IN (:...driverIds)', { driverIds });
    }

    const profiles = (await qb.getMany()).filter(
      (p) => p.shift && this.shiftCovers(p.shift.startTime, p.shift.endTime, now),
    );

    if (!profiles.length) return [];

    const driverIdsAll = profiles.map((p) => p.id);
    const [taskRows, doneRows] = await Promise.all([
      this.taskCountsByDriver(driverIdsAll),
      this.completedTodayByDriver(driverIdsAll),
    ]);

    const busyDrivers = new Set(taskRows.busy);
    const fallbacks = await this.coverageFallbacks(driverIdsAll);
    const requestWeight = Number(request.estimatedWeightKg);

    return profiles
      .filter((p) => !busyDrivers.has(p.id))
      .map((p) => {
        const tasks = taskRows.tasks.get(p.id) ?? { count: 0, weightKg: 0 };
        const truck = p.assignment?.truck;
        const maxPayloadKg = truck?.maxPayloadKg != null ? Number(truck.maxPayloadKg) : null;
        const remainingKg =
          maxPayloadKg != null ? maxPayloadKg - tasks.weightKg : null;

        return {
          driverId: p.id,
          accountId: p.account.id,
          truckId: truck?.id ?? '',
          maxPayloadKg,
          shiftStart: p.shift.startTime,
          shiftEnd: p.shift.endTime,
          activeTasks: tasks.count,
          activeWeightKg: tasks.weightKg,
          completedToday: doneRows.get(p.id) ?? 0,
          fallbackLocation: fallbacks.get(p.id) ?? null,
          passesCapacity:
            remainingKg == null || remainingKg >= requestWeight,
        } satisfies DriverCandidate;
      })
      .filter((c) => c.passesCapacity);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  /** Covers "now" including an overnight shift (22:00 -> 06:00). */
  private shiftCovers(startTime: string, endTime: string, now: Date): boolean {
    const toMin = (t: string): number => {
      const [, h, m, s] = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t) ?? [];
      return Number(h) * 60 + Number(m) + (s ? Number(s) / 60 : 0);
    };
    const start = toMin(startTime);
    const end = toMin(endTime);
    const current = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

    if (start === end) return true; // 24h shift
    return start < end
      ? current >= start && current < end
      : current >= start || current < end;
  }

  /** Per-driver active-task count and summed payload, plus the busy set. */
  private async taskCountsByDriver(driverIds: string[]) {
    const rows = await this.requestRepo
      .createQueryBuilder('r')
      .innerJoin('r.route', 'route')
      .select('route.driverId', 'driverId')
      .addSelect('COUNT(*)', 'taskCount')
      .addSelect(
        `COALESCE(SUM(CASE WHEN r."actual_weight_kg" IS NOT NULL THEN r."actual_weight_kg" ELSE r."estimated_weight_kg" END), 0)`,
        'taskWeight',
      )
      .where('r.status IN (:...statuses)', {
        statuses: ACTIVE_TASK_STATUSES,
      })
      .andWhere('route.driverId IN (:...driverIds)', { driverIds })
      .groupBy('route.driverId')
      .getRawMany<{ driverId: string; taskCount: string; taskWeight: string }>();

    const tasks = new Map<string, { count: number; weightKg: number }>();
    const busy = new Set<string>();
    for (const row of rows) {
      tasks.set(row.driverId, {
        count: Number(row.taskCount),
        weightKg: Number(row.taskWeight),
      });
    }

    const busyRows = await this.requestRepo
      .createQueryBuilder('r')
      .innerJoin('r.route', 'route')
      .select('DISTINCT route.driverId', 'driverId')
      .where('r.status IN (:...statuses)', { statuses: BUSY_STATUSES })
      .andWhere('route.driverId IN (:...driverIds)', { driverIds })
      .getRawMany<{ driverId: string }>();
    busyRows.forEach((row) => busy.add(row.driverId));

    return { tasks, busy };
  }

  /** Per-driver COMPLETED count since local midnight (the fairness factor). */
  private async completedTodayByDriver(driverIds: string[]): Promise<Map<string, number>> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const rows = await this.requestRepo
      .createQueryBuilder('r')
      .innerJoin('r.route', 'route')
      .select('route.driverId', 'driverId')
      .addSelect('COUNT(*)', 'doneCount')
      .where('r.status = :status', { status: CollectionRequestStatus.COMPLETED })
      .andWhere('r.completedAt >= :since', { since: startOfDay })
      .andWhere('route.driverId IN (:...driverIds)', { driverIds })
      .groupBy('route.driverId')
      .getRawMany<{ driverId: string; doneCount: string }>();

    return new Map(rows.map((r) => [r.driverId, Number(r.doneCount)]));
  }

  /** Fallback parked locations from the coverage assignment (live fix wins in scoring). */
  private async coverageFallbacks(
    driverIds: string[],
  ): Promise<Map<string, FallbackLocation>> {
    const rows = await this.coverageRepo
      .createQueryBuilder('dca')
      .innerJoinAndSelect('dca.coveragePoint', 'point')
      .where('dca.driverId IN (:...driverIds)', { driverIds })
      .andWhere('dca.isActive = true')
      .andWhere('point.isActive = true')
      .getMany();

    return new Map(
      rows.map((r) => [
        r.driverId,
        {
          lat: Number(r.coveragePoint.lat),
          lng: Number(r.coveragePoint.lng),
        },
      ]),
    );
  }
}