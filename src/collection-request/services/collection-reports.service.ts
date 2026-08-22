import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CollectionRequest } from '../entities/collection-request.entity';
import { CollectionRoute } from '../entities/collection-route.entity';
import { CollectionRequestStatus } from '../enums/collection-request-status.enum';
import { CollectionRouteStatus } from '../enums/collection-route-status.enum';

/**
 * Admin reports over the collection domain: one workday's summary (requests by
 * status, weighed tonnage, money actually paid out), the request ledger with
 * date/status/driver filters, and the routes ledger with per-route stop and
 * value totals. Read-only aggregates — the answers never mutate anything.
 */
@Injectable()
export class CollectionReportsService {
  constructor(
    @InjectRepository(CollectionRequest)
    private readonly requestRepo: Repository<CollectionRequest>,
    @InjectRepository(CollectionRoute)
    private readonly routeRepo: Repository<CollectionRoute>,
  ) {}

  /** One day's summary (UTC day when `date` is omitted → today). */
  async daily(date?: string) {
    const day = date ? new Date(`${date}T00:00:00Z`) : new Date();
    if (Number.isNaN(day.getTime())) {
      day.setTime(new Date().getTime());
    }
    const start = new Date(day);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const [requestRows, routeRows] = await Promise.all([
      this.requestRepo
        .createQueryBuilder('r')
        .select('r.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .addSelect(`COALESCE(SUM(r."actual_weight_kg"), 0)`, 'weightKg')
        .addSelect(`COALESCE(SUM(r."actual_grand_total"), 0)`, 'value')
        .where('r.createdAt >= :from AND r.createdAt < :to', {
          from: start,
          to: end,
        })
        .groupBy('r.status')
        .getRawMany<{
          status: CollectionRequestStatus;
          count: string;
          weightKg: string;
          value: string;
        }>(),
      this.routeRepo
        .createQueryBuilder('rt')
        .select('rt.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('rt.createdAt >= :from AND rt.createdAt < :to', {
          from: start,
          to: end,
        })
        .groupBy('rt.status')
        .getRawMany<{ status: CollectionRouteStatus; count: string }>(),
    ]);

    const byStatus = new Map<string, string>();
    let collectedKg = 0;
    let paidOut = 0;
    for (const row of requestRows) {
      byStatus.set(row.status, row.count);
      // Weighed+completed stops are the money that actually moved.
      if (row.status === CollectionRequestStatus.COMPLETED) {
        collectedKg += Number(row.weightKg);
        paidOut += Number(row.value);
      }
    }

    const routeByStatus = new Map<string, string>();
    for (const row of routeRows) routeByStatus.set(row.status, row.count);

    return {
      date: start.toISOString().slice(0, 10),
      requests: {
        total: totalOf(byStatus),
        by_status: Object.fromEntries(byStatus),
        collected_weight_kg: round2(collectedKg),
        paid_out_value: round2(paidOut),
      },
      routes: {
        total: totalOf(routeByStatus),
        by_status: Object.fromEntries(routeByStatus),
      },
    };
  }

  /** The request ledger with filters, pagination and whole-window totals. */
  async requests(query: {
    status?: CollectionRequestStatus;
    type?: string;
    from?: string;
    to?: string;
    driverId?: string;
    page: number;
    limit: number;
  }) {
    const qb = this.requestRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.lines', 'lines')
      .leftJoin('r.route', 'route');
    this.applyWindow(qb, query);

    if (query.status) qb.andWhere('r.status = :status', { status: query.status });
    if (query.type) qb.andWhere('r.type = :type', { type: query.type });
    if (query.driverId) {
      qb.andWhere('route.driverId = :driverId', { driverId: query.driverId });
    }

    const page = Math.max(1, query.page);
    const limit = Math.min(100, Math.max(1, query.limit));
    const [rows, total] = await qb
      .orderBy('r.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const totals = await this.aggregate(query);
    return {
      requests: rows.map((r) => ({
        request_id: r.id,
        request_number: r.requestNumber,
        type: r.type,
        status: r.status,
        account_id: r.accountId,
        route_id: r.routeId ?? null,
        driver_id: r.route?.driverId ?? null,
        scheduled_at: r.scheduledAt ?? null,
        estimated_weight_kg: Number(r.estimatedWeightKg),
        actual_weight_kg: r.actualWeightKg != null ? Number(r.actualWeightKg) : null,
        estimated_grand_total: Number(r.estimatedGrandTotal),
        actual_grand_total:
          r.actualGrandTotal != null ? Number(r.actualGrandTotal) : null,
        created_at: r.createdAt,
      })),
      totals,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /** The routes ledger with per-route stop counts and value. */
  async routes(query: { from?: string; to?: string; driverId?: string }) {
    const qb = this.routeRepo
      .createQueryBuilder('rt')
      .leftJoinAndSelect('rt.requests', 'r')
      .leftJoin('rt.driver', 'cp');
    if (query.from) {
      qb.andWhere('rt.createdAt >= :from', { from: new Date(query.from) });
    }
    if (query.to) {
      qb.andWhere('rt.createdAt < :to', { to: new Date(query.to) });
    }
    if (query.driverId) {
      qb.andWhere('rt.driverId = :driverId', { driverId: query.driverId });
    }

    const routes = await qb.orderBy('rt.createdAt', 'DESC').getMany();

    let totalWeightKg = 0;
    let totalValue = 0;
    const rows = routes.map((route) => {
      const stops = route.requests ?? [];
      const completed = stops.filter(
        (s) => s.status === CollectionRequestStatus.COMPLETED,
      );
      const weightKg = completed.reduce(
        (sum, s) => sum + (s.actualWeightKg != null ? Number(s.actualWeightKg) : 0),
        0,
      );
      const value = completed.reduce(
        (sum, s) =>
          sum +
          (s.actualGrandTotal != null
            ? Number(s.actualGrandTotal)
            : Number(s.estimatedGrandTotal)),
        0,
      );
      totalWeightKg += weightKg;
      totalValue += value;
      return {
        route_id: route.id,
        route_number: route.routeNumber,
        status: route.status,
        driver_id: route.driverId,
        stops_total: stops.length,
        stops_completed: completed.length,
        collected_weight_kg: round2(weightKg),
        collected_value: round2(value),
        started_at: route.startedAt ?? null,
        completed_at: route.completedAt ?? null,
        created_at: route.createdAt,
      };
    });

    return {
      routes: rows,
      totals: {
        routes: routes.length,
        collected_weight_kg: round2(totalWeightKg),
        collected_value: round2(totalValue),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private applyWindow(
    qb: ReturnType<Repository<CollectionRequest>['createQueryBuilder']>,
    query: { from?: string; to?: string },
  ): void {
    if (query.from) qb.andWhere('r.createdAt >= :from', { from: new Date(query.from) });
    if (query.to) qb.andWhere('r.createdAt < :to', { to: new Date(query.to) });
  }

  private async aggregate(query: {
    status?: CollectionRequestStatus;
    type?: string;
    from?: string;
    to?: string;
    driverId?: string;
  }) {
    const qb = this.requestRepo
      .createQueryBuilder('r')
      .leftJoin('r.route', 'route')
      .select('COUNT(*)', 'total')
      .addSelect(`COALESCE(SUM(r."actual_weight_kg"), 0)`, 'weightKg')
      .addSelect(
        `COALESCE(SUM(CASE WHEN r."actual_grand_total" IS NOT NULL THEN r."actual_grand_total" ELSE r."estimated_grand_total" END), 0)`,
        'value',
      );
    this.applyWindow(qb, query);
    if (query.status) qb.andWhere('r.status = :status', { status: query.status });
    if (query.type) qb.andWhere('r.type = :type', { type: query.type });
    if (query.driverId) {
      qb.andWhere('route.driverId = :driverId', { driverId: query.driverId });
    }

    const row = await qb.getRawOne<{
      total: string;
      weightKg: string;
      value: string;
    }>();
    return {
      total_requests: Number(row?.total ?? 0),
      collected_weight_kg: round2(Number(row?.weightKg ?? 0)),
      collected_value: round2(Number(row?.value ?? 0)),
    };
  }
}

function totalOf(map: Map<string, string>): number {
  let sum = 0;
  for (const count of map.values()) sum += Number(count);
  return sum;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}