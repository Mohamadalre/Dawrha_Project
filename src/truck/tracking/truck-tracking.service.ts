import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { TruckAssignmentEntity } from '../entities/truck-assignment.entity';
import { TruckLocationLog } from '../entities/truck-location-log.entity';
import { TruckHandover } from '../entities/truck-handover.entity';
import { HandoverStatus } from '../enums/handover-status.enum';
import { StopReason } from './enums/stop-reason.enum';
import { StoredTruckLocation, TruckLocationDto } from './dto/truck-location.dto';

/**
 * Stores and reads live truck coordinates in Redis.
 *
 * Keys:
 *  - `truck:location:{truckId}`  → JSON of the latest position (TTL: LOCATION_TTL)
 *  - `truck:active`              → ZSET member=truckId, score=last-seen epoch ms
 *  - `truck:history:{truckId}`   → capped list of the last HISTORY_LIMIT positions
 */
@Injectable()
export class TruckTrackingService {
  private static readonly LOCATION_TTL = 60 * 60; // 1 hour
  private static readonly HISTORY_LIMIT = 100;
  private static readonly ACTIVE_KEY = 'truck:active';
  /** A truck idle longer than this is treated as "stopped" by the cron. */
  private static readonly INACTIVITY_MS = 15 * 60 * 1000;

  private readonly logger = new Logger('TRUCK_TRACKING');

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @InjectRepository(TruckAssignmentEntity)
    private readonly assignmentRepo: Repository<TruckAssignmentEntity>,
    @InjectRepository(TruckLocationLog)
    private readonly locationLogRepo: Repository<TruckLocationLog>,
    @InjectRepository(TruckHandover)
    private readonly handoverRepo: Repository<TruckHandover>,
  ) {}

  private locationKey(truckId: string): string {
    return `truck:location:${truckId}`;
  }

  private historyKey(truckId: string): string {
    return `truck:history:${truckId}`;
  }

  /** Persists a new position and marks the truck as active. */
  async saveLocation(
    dto: TruckLocationDto,
    driverId?: string,
  ): Promise<StoredTruckLocation> {
    const payload: StoredTruckLocation = {
      truckId: dto.truckId,
      lat: dto.lat,
      lng: dto.lng,
      speed: dto.speed,
      heading: dto.heading,
      driverId,
      updatedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(payload);
    const now = Date.now();

    await this.redis
      .multi()
      .set(this.locationKey(dto.truckId), json, 'EX', TruckTrackingService.LOCATION_TTL)
      .zadd(TruckTrackingService.ACTIVE_KEY, now, dto.truckId)
      .lpush(this.historyKey(dto.truckId), json)
      .ltrim(this.historyKey(dto.truckId), 0, TruckTrackingService.HISTORY_LIMIT - 1)
      .expire(this.historyKey(dto.truckId), TruckTrackingService.LOCATION_TTL)
      .exec();

    return payload;
  }

  /** Returns the last known position of a truck, or null if none stored. */
  async getLocation(truckId: string): Promise<StoredTruckLocation | null> {
    const raw = await this.redis.get(this.locationKey(truckId));
    return raw ? (JSON.parse(raw) as StoredTruckLocation) : null;
  }

  /** Lists trucks seen within the given window (default 5 minutes). */
  async getActiveTrucks(withinMs = 5 * 60 * 1000): Promise<StoredTruckLocation[]> {
    const since = Date.now() - withinMs;
    const truckIds = await this.redis.zrangebyscore(
      TruckTrackingService.ACTIVE_KEY,
      since,
      '+inf',
    );
    if (truckIds.length === 0) return [];

    const keys = truckIds.map((id) => this.locationKey(id));
    const values = await this.redis.mget(keys);
    return values
      .filter((v): v is string => !!v)
      .map((v) => JSON.parse(v) as StoredTruckLocation);
  }

  /** Returns recent position history for a truck (most-recent first). */
  async getHistory(truckId: string, limit = 50): Promise<StoredTruckLocation[]> {
    const items = await this.redis.lrange(
      this.historyKey(truckId),
      0,
      Math.max(0, limit - 1),
    );
    return items.map((v) => JSON.parse(v) as StoredTruckLocation);
  }

  /**
   * Finalises a truck stop: reads its last known position from Redis, persists it
   * to the database (`truck_location_logs`), and removes the truck from the active
   * set. Returns the saved log, or null when there is no position to persist.
   */
  async finalizeStop(
    truckId: string,
    reason: StopReason,
  ): Promise<TruckLocationLog | null> {
    const location = await this.getLocation(truckId);
    // Always drop it from the active set, even if there is nothing to persist.
    await this.redis.zrem(TruckTrackingService.ACTIVE_KEY, truckId);
    if (!location) return null;

    const log = await this.locationLogRepo.save(
      this.locationLogRepo.create({
        truckId,
        lat: String(location.lat),
        lng: String(location.lng),
        speed: location.speed != null ? String(location.speed) : undefined,
        heading: location.heading != null ? String(location.heading) : undefined,
        driverId: location.driverId,
        reason,
        recordedAt: new Date(location.updatedAt),
      }),
    );

    this.logger.log(`Stored stop location for truck ${truckId} (${reason})`);
    return log;
  }

  /** Returns the latest persisted stop record for a truck (if any). */
  async getLastStop(truckId: string): Promise<TruckLocationLog | null> {
    return this.locationLogRepo.findOne({
      where: { truckId },
      order: { recordedAt: 'DESC' },
    });
  }

  /** Truck IDs that are in the active set but idle past the inactivity window. */
  private async getStaleTruckIds(thresholdMs: number): Promise<string[]> {
    return this.redis.zrangebyscore(
      TruckTrackingService.ACTIVE_KEY,
      '-inf',
      Date.now() - thresholdMs,
    );
  }

  /**
   * Safety net: every 5 minutes, persist + retire trucks that stopped sending
   * coordinates (e.g. app killed without a clean disconnect).
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async flushInactiveTrucks(): Promise<void> {
    try {
      const stale = await this.getStaleTruckIds(TruckTrackingService.INACTIVITY_MS);
      for (const truckId of stale) {
        await this.finalizeStop(truckId, StopReason.INACTIVITY);
      }
      if (stale.length) {
        this.logger.log(`Flushed ${stale.length} inactive truck(s) to DB`);
      }
    } catch (error) {
      this.logger.error('flushInactiveTrucks failed', error as Error);
    }
  }

  /** Prunes stale entries from the active set (housekeeping). */
  async pruneActive(olderThanMs = 30 * 60 * 1000): Promise<void> {
    await this.redis.zremrangebyscore(
      TruckTrackingService.ACTIVE_KEY,
      '-inf',
      Date.now() - olderThanMs,
    );
  }

  /**
   * Confirms the collector account is the driver assigned to this truck.
   * Returns false when no matching assignment exists.
   */
  async isDriverOfTruck(accountId: string, truckId: string): Promise<boolean> {
    const count = await this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoin('a.driver', 'driver')
      .innerJoin('driver.account', 'account')
      .innerJoin('a.truck', 'truck')
      .where('account.id = :accountId', { accountId })
      .andWhere('truck.id = :truckId', { truckId })
      .getCount();
    return count > 0;
  }

  /**
   * Is this driver ACTIVELY OPERATING this truck right now?
   *
   * True only while an OPEN handover exists — i.e. the driver pressed "pick up"
   * (استلام/تشغيل الشاحنة) and has not yet handed it back. This is the gate that
   * makes tracking live ONLY for a truck a driver is actually running: an
   * assigned-but-not-picked-up truck (no open session) is NOT tracked, and since
   * only COLLECTION trucks have a handover flow at all (delivery trucks are
   * Odoo's), tracking is naturally limited to the collection fleet in operation.
   */
  async hasActiveHandover(accountId: string, truckId: string): Promise<boolean> {
    const count = await this.handoverRepo
      .createQueryBuilder('h')
      .innerJoin('h.driver', 'driver')
      .innerJoin('driver.account', 'account')
      .where('account.id = :accountId', { accountId })
      .andWhere('h.truckId = :truckId', { truckId })
      .andWhere('h.status = :status', { status: HandoverStatus.OPEN })
      .getCount();
    return count > 0;
  }
}
