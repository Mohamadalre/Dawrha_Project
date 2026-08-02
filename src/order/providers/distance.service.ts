import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { WarehouseState } from '@src/warehouse/enums/warehouse-state.enum';
import { DistanceCache } from '../entities/distance-cache.entity';
import {
  DistanceSource,
  PROVISIONAL_SOURCES,
} from '../enums/distance-source.enum';
import { MAX_CANDIDATE_WAREHOUSES } from '../order.config';

const LOG_META = { context: 'DISTANCE', channel: 'orders' } as const;

/** Google allows 25 destinations per request; stay well inside it. */
const MAX_DESTINATIONS_PER_CALL = 25;

/**
 * Inline budget when a brand-new pair has to be measured during a checkout.
 * Deliberately tight: the buyer is waiting, and a provisional answer now that
 * the refresh sweep upgrades in minutes beats a spinner.
 */
const INLINE_TIMEOUT_MS = 3000;

/** Background budget — nobody is waiting, so give it room to succeed. */
const BACKGROUND_TIMEOUT_MS = 15000;

/**
 * Google statuses worth trying again. OVER_QUERY_LIMIT and UNKNOWN_ERROR are
 * transient; REQUEST_DENIED and INVALID_REQUEST mean the key or the request is
 * wrong, and retrying those just burns quota against a problem only a human can
 * fix — so they are logged loudly instead.
 */
const RETRYABLE_STATUSES = new Set(['OVER_QUERY_LIMIT', 'UNKNOWN_ERROR']);

/**
 * How long before a provisional row is retried after a failed upgrade. Stops a
 * permanently unroutable pair from being asked on every single sweep.
 */
const UPGRADE_BACKOFF_MINUTES = 30;

/** A warehouse the buyer could be served from, with how far away it is. */
export interface WarehouseDistance {
  warehouseId: string;
  distanceKm: number;
  source: DistanceSource;
}

interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Distances between a buyer and the warehouses that could serve them.
 *
 * Google's Distance Matrix is the SOURCE OF TRUTH here: delivery is charged per
 * kilometre, and a straight line under-reads a real drive badly in a city, so
 * the buyer would be undercharged and the driver's trip mispriced.
 *
 * What is minimised is not its use but its COST. Google bills per
 * origin×destination element, and both endpoints are effectively static — a
 * factory does not move, and neither does a warehouse — so each pair should be
 * measured once and then never again:
 *
 *   1. PostGIS ranks the governorate's warehouses for free and keeps only the
 *      nearest handful, so Google is never asked about more than a few
 *      destinations.
 *   2. The cache answers for every pair already measured — after warm-up, that
 *      is all of them, and an order costs zero calls.
 *   3. Google is asked ONLY for pairs still missing, in ONE batched request
 *      (one origin × up to 25 destinations).
 *
 * When Google does not answer, the straight-line distance is stored as
 * PROVISIONAL and the sweep upgrades it as soon as the service returns. That
 * distinction is the whole point: an earlier version cached the fallback like
 * any other row, so a single transient outage pinned a pair to an estimate
 * forever and delivery was priced on it. A provisional row is a promise to come
 * back, not an answer.
 */
@Injectable()
export class DistanceService {
  private readonly apiKey: string | undefined;
  /** Warn about a missing key once per process, not once per order. */
  private missingKeyWarned = false;

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
    @InjectRepository(DistanceCache)
    private readonly cacheRepo: Repository<DistanceCache>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
  ) {
    this.apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY') || undefined;
  }

  /**
   * The warehouses that may serve this buyer, nearest first.
   *
   * Only ACTIVE warehouses in the buyer's own governorate are considered:
   * `closing` exists precisely to stop new work arriving, and a warehouse in
   * another governorate is out of scope by policy.
   */
  async rankWarehouses(params: {
    buyerProfileId: string;
    provinceId: string;
    limit?: number;
  }): Promise<WarehouseDistance[]> {
    const limit = params.limit ?? MAX_CANDIDATE_WAREHOUSES;
    const shortlist = await this.shortlistByStraightLine(
      params.buyerProfileId,
      params.provinceId,
      limit,
    );
    if (!shortlist.length) return [];

    const ids = shortlist.map((w) => w.warehouseId);
    const resolved = await this.resolveDistances(params.buyerProfileId, ids, shortlist);
    return resolved.sort((a, b) => a.distanceKm - b.distanceKm);
  }

  /**
   * Free first pass: order the governorate's warehouses by great-circle
   * distance and keep the nearest `limit`.
   *
   * This is what bounds the paid call — Google is only ever asked about a
   * handful of candidates, never the whole country.
   */
  private async shortlistByStraightLine(
    buyerProfileId: string,
    provinceId: string,
    limit: number,
  ): Promise<WarehouseDistance[]> {
    const rows = await this.warehouseRepo.query(
      `
      WITH buyer AS (
        SELECT coordinates FROM factory_profiles WHERE id = $1
        UNION ALL
        SELECT coordinates FROM external_partner_profiles WHERE id = $1
        LIMIT 1
      )
      SELECT w.id AS warehouse_id,
             ST_Distance(
               (SELECT coordinates FROM buyer),
               ST_SetSRID(ST_MakePoint(w.longitude::float8, w.latitude::float8), 4326)::geography
             ) / 1000.0 AS distance_km
        FROM warehouses w
       WHERE w.province_id = $2
         AND w.is_active = true
         AND w.state = $3
         AND w.latitude IS NOT NULL
         AND w.longitude IS NOT NULL
         AND (SELECT coordinates FROM buyer) IS NOT NULL
       ORDER BY distance_km ASC
       LIMIT $4
      `,
      [buyerProfileId, provinceId, WarehouseState.ACTIVE, limit],
    );

    return rows.map((r: { warehouse_id: string; distance_km: string }) => ({
      warehouseId: r.warehouse_id,
      distanceKm: Number(r.distance_km),
      source: DistanceSource.HAVERSINE,
    }));
  }

  /**
   * Cache first, Google for the gaps.
   *
   * A cached GOOGLE row is final and returned as-is. A cached PROVISIONAL row
   * is still usable — the buyer is not made to wait — but it does NOT stop the
   * pair being upgraded later; that is what the refresh sweep is for.
   *
   * `fallback` carries the straight-line numbers PostGIS already produced, so a
   * Google failure costs nothing extra: the pair still gets a usable distance
   * and is stored as provisional.
   */
  private async resolveDistances(
    buyerProfileId: string,
    warehouseIds: string[],
    fallback: WarehouseDistance[],
  ): Promise<WarehouseDistance[]> {
    const cached = await this.cacheRepo.find({
      where: { buyerProfileId, warehouseId: In(warehouseIds) },
    });
    const byWarehouse = new Map<string, WarehouseDistance>(
      cached.map((c) => [
        c.warehouseId,
        {
          warehouseId: c.warehouseId,
          distanceKm: Number(c.distanceKm),
          source: c.source,
        },
      ]),
    );

    const missing = warehouseIds.filter((id) => !byWarehouse.has(id));
    if (!missing.length) return [...byWarehouse.values()];

    // A brand-new buyer: measure now, on a tight budget, because a wrong
    // distance would misprice their very first delivery.
    const fresh = await this.measure(
      buyerProfileId,
      missing,
      fallback,
      INLINE_TIMEOUT_MS,
    );
    await this.persist(buyerProfileId, fresh);
    for (const entry of fresh) byWarehouse.set(entry.warehouseId, entry);
    return [...byWarehouse.values()];
  }

  /**
   * Road distances for the given pairs, falling back to the straight line.
   *
   * Every failure path lands on the provisional estimate rather than throwing:
   * an order that cannot be ranked or priced is a far worse outcome than a
   * distance that is briefly approximate and self-corrects.
   */
  private async measure(
    buyerProfileId: string,
    warehouseIds: string[],
    fallback: WarehouseDistance[],
    timeoutMs: number,
  ): Promise<WarehouseDistance[]> {
    const estimates = warehouseIds.map(
      (id) =>
        fallback.find((f) => f.warehouseId === id) ?? {
          warehouseId: id,
          distanceKm: 0,
          source: DistanceSource.HAVERSINE,
        },
    );

    if (!this.apiKey) {
      // Loud, and only once per process: running without a key silently means
      // every delivery in the system is priced on a straight line.
      this.warnMissingKeyOnce();
      return estimates;
    }

    const [origin, destinations] = await Promise.all([
      this.buyerCoordinates(buyerProfileId),
      this.warehouseCoordinates(warehouseIds),
    ]);
    if (!origin || destinations.length !== warehouseIds.length) return estimates;

    try {
      const road = await this.callDistanceMatrix(origin, destinations, timeoutMs);
      // A per-element failure (an unroutable pair) keeps that pair's estimate
      // without spoiling the others in the same batch.
      return warehouseIds.map((id, index) => {
        const km = road[index];
        return km == null
          ? estimates[index]
          : { warehouseId: id, distanceKm: km, source: DistanceSource.GOOGLE };
      });
    } catch (err) {
      winstonLogger.warn(
        `Distance Matrix unavailable (${(err as Error).message}) — using provisional straight-line distances; the refresh sweep will upgrade them`,
        LOG_META,
      );
      return estimates;
    }
  }

  /**
   * ONE request: a single origin against every destination in the batch.
   *
   * Batching is the cost control — Google bills per origin×destination element,
   * and asking about ten warehouses one at a time costs the same as asking
   * about them together but ten times the latency and ten times the chance of
   * a transient failure.
   */
  private async callDistanceMatrix(
    origin: Coordinates,
    destinations: Coordinates[],
    timeoutMs: number,
  ): Promise<(number | null)[]> {
    const batch = destinations.slice(0, MAX_DESTINATIONS_PER_CALL);
    const response = await firstValueFrom(
      this.http.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
        timeout: timeoutMs,
        params: {
          origins: `${origin.lat},${origin.lng}`,
          destinations: batch.map((d) => `${d.lat},${d.lng}`).join('|'),
          units: 'metric',
          key: this.apiKey,
        },
      }),
    );

    const status = response.data?.status;
    if (status !== 'OK') {
      // Separate "try again later" from "a human must fix this": retrying a
      // denied key burns quota against a problem no retry can solve.
      if (!RETRYABLE_STATUSES.has(status)) {
        winstonLogger.error(
          `Distance Matrix rejected the request: ${status} — ${response.data?.error_message ?? 'no detail'}`,
          LOG_META,
        );
      }
      throw new Error(`Distance Matrix returned ${status}`);
    }

    const elements = response.data?.rows?.[0]?.elements ?? [];
    return batch.map((_, i) => {
      const element = elements[i];
      // ZERO_RESULTS / NOT_FOUND are per-pair facts, not request failures:
      // that one warehouse keeps its estimate and the rest are still real.
      if (element?.status !== 'OK' || typeof element?.distance?.value !== 'number') {
        return null;
      }
      return element.distance.value / 1000;
    });
  }

  private warnMissingKeyOnce(): void {
    if (this.missingKeyWarned) return;
    this.missingKeyWarned = true;
    winstonLogger.warn(
      'GOOGLE_MAPS_API_KEY is not set — every distance will be a straight-line estimate, and delivery is priced per kilometre. Set the key to get real road distances.',
      LOG_META,
    );
  }


  private async buyerCoordinates(profileId: string): Promise<Coordinates | null> {
    const rows = await this.warehouseRepo.query(
      `
      SELECT ST_Y(coordinates::geometry) AS lat, ST_X(coordinates::geometry) AS lng
        FROM (
          SELECT coordinates FROM factory_profiles WHERE id = $1
          UNION ALL
          SELECT coordinates FROM external_partner_profiles WHERE id = $1
        ) p
       WHERE coordinates IS NOT NULL
       LIMIT 1
      `,
      [profileId],
    );
    if (!rows.length) return null;
    return { lat: Number(rows[0].lat), lng: Number(rows[0].lng) };
  }

  /** Returned in the SAME order as `warehouseIds`, so indexes line up. */
  private async warehouseCoordinates(
    warehouseIds: string[],
  ): Promise<Coordinates[]> {
    const warehouses = await this.warehouseRepo.find({
      where: { id: In(warehouseIds) },
    });
    const byId = new Map(warehouses.map((w) => [w.id, w]));
    const out: Coordinates[] = [];
    for (const id of warehouseIds) {
      const w = byId.get(id);
      if (!w?.latitude || !w?.longitude) return [];
      out.push({ lat: Number(w.latitude), lng: Number(w.longitude) });
    }
    return out;
  }

  private async persist(
    buyerProfileId: string,
    entries: WarehouseDistance[],
  ): Promise<void> {
    for (const entry of entries) {
      await this.cacheRepo
        .createQueryBuilder()
        .insert()
        .into(DistanceCache)
        .values({
          buyerProfileId,
          warehouseId: entry.warehouseId,
          distanceKm: String(entry.distanceKm),
          source: entry.source,
        })
        // Concurrent orders from the same buyer can race to fill the same pair;
        // the unique index turns that into an update instead of a crash.
        .orUpdate(['distance_km', 'source'], ['buyer_profile_id', 'warehouse_id'])
        .execute();
    }
  }

  /**
   * Upgrades PROVISIONAL rows to real road distances.
   *
   * This is what makes the fallback genuinely temporary. Without it, one
   * transient Google outage would pin a pair to a straight-line estimate
   * forever — and since delivery is charged per kilometre, that estimate would
   * quietly undercharge every future delivery on that route.
   *
   * Grouped by buyer so each one costs a single batched request, and bounded
   * per run so a large backlog is worked through steadily instead of in one
   * burst against the quota.
   */
  async upgradeProvisionalDistances(limit = 200): Promise<{
    attempted: number;
    upgraded: number;
  }> {
    if (!this.apiKey) return { attempted: 0, upgraded: 0 };

    // Skip rows attempted recently: a genuinely unroutable pair must not be
    // re-asked on every sweep.
    const retryAfter = new Date(Date.now() - UPGRADE_BACKOFF_MINUTES * 60_000);
    const stale = await this.cacheRepo.find({
      where: {
        source: In([...PROVISIONAL_SOURCES]),
        computedAt: LessThan(retryAfter),
      },
      take: limit,
    });
    if (!stale.length) return { attempted: 0, upgraded: 0 };

    const byBuyer = new Map<string, string[]>();
    for (const row of stale) {
      const list = byBuyer.get(row.buyerProfileId) ?? [];
      list.push(row.warehouseId);
      byBuyer.set(row.buyerProfileId, list);
    }

    let upgraded = 0;
    for (const [buyerProfileId, warehouseIds] of byBuyer) {
      const previous = stale
        .filter((r) => r.buyerProfileId === buyerProfileId)
        .map((r) => ({
          warehouseId: r.warehouseId,
          distanceKm: Number(r.distanceKm),
          source: r.source,
        }));
      const measured = await this.measure(
        buyerProfileId,
        warehouseIds,
        previous,
        BACKGROUND_TIMEOUT_MS,
      );
      // Persist everything, including the ones that failed again: touching the
      // row is what starts their back-off window.
      await this.persist(buyerProfileId, measured);
      upgraded += measured.filter((m) => m.source === DistanceSource.GOOGLE).length;
    }

    winstonLogger.info(
      `Distance refresh: ${upgraded}/${stale.length} provisional pair(s) upgraded to road distances`,
      LOG_META,
    );
    return { attempted: stale.length, upgraded };
  }

  /**
   * Measures every pair for a buyer up front, so their first order needs no
   * call at all. Safe to re-run: pairs already measured are read from cache.
   */
  async warmUp(buyerProfileId: string, provinceId: string): Promise<number> {
    const ranked = await this.rankWarehouses({
      buyerProfileId,
      provinceId,
      limit: MAX_CANDIDATE_WAREHOUSES,
    });
    return ranked.length;
  }
  /** Drops a buyer's cached pairs — call when their coordinates change. */
  async invalidateBuyer(buyerProfileId: string): Promise<void> {
    await this.cacheRepo.delete({ buyerProfileId });
  }

  /** Drops a warehouse's cached pairs — call when it moves. */
  async invalidateWarehouse(warehouseId: string): Promise<void> {
    await this.cacheRepo.delete({ warehouseId });
  }
}
