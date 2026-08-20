import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { TruckStatus } from '@src/truck/enums/truck-status.enum';
import { HandoverStatus } from '@src/truck/enums/handover-status.enum';
import { TruckHandover } from '@src/truck/entities/truck-handover.entity';
import { CoveragePoint } from '../entities/coverage-point.entity';
import { DriverCoverageAssignment } from '../entities/driver-coverage-assignment.entity';
import { CollectionRequest } from '../entities/collection-request.entity';
import {
  CollectionRequestStatus,
} from '../enums/collection-request-status.enum';

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

  constructor(
    @InjectRepository(CoveragePoint)
    private readonly pointRepo: Repository<CoveragePoint>,
    @InjectRepository(DriverCoverageAssignment)
    private readonly assignmentRepo: Repository<DriverCoverageAssignment>,
    @InjectRepository(TruckHandover)
    private readonly handoverRepo: Repository<TruckHandover>,
    @InjectRepository(CollectionRequest)
    private readonly requestRepo: Repository<CollectionRequest>,
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
      .select('DISTINCT cp.id', 'driverId')
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
    const current = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

    if (start === end) return true;
    return start < end
      ? current >= start && current < end
      : current >= start || current < end;
  }
}