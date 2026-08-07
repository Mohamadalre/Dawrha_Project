import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Per-account resources whose reads are cached.
 *
 * Distinct from `CatalogCacheService`, which caches catalogue-wide listings and
 * invalidates them for everyone by bumping a single version counter. That is
 * exactly wrong for account data: one user editing their profile must not
 * expire every other user's cached profile. So invalidation here is scoped to
 * ONE account via a per-account version, bumped only when that account's data
 * changes.
 */
export type UserCacheResource = 'profile' | 'locations' | 'location' | 'sessions';

/**
 * Read-through cache for a single account's own data (profile, its locations, a
 * location's detail, its active sessions).
 *
 * Keys embed a per-account version: `user:<res>:<accountId>:v<N>:<parts>`.
 * `invalidate(accountId, ...res)` bumps only that account's version, so its
 * stale keys become unreachable in O(1) — no SCAN, no cross-account blast
 * radius — and expire on their TTL. The next read repopulates (cache-aside).
 *
 * Fail-open: any Redis error falls through to the database.
 */
@Injectable()
export class UserCacheService {
  private readonly logger = new Logger(UserCacheService.name);

  /** TTL per resource (seconds). Account data changes rarely, so these are long. */
  private readonly ttl: Record<UserCacheResource, number> = {
    profile: 6 * 60 * 60, // 6h
    locations: 6 * 60 * 60, // 6h
    location: 6 * 60 * 60, // 6h
    sessions: 5 * 60, // 5m — device list moves with every login/logout
  };

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  private versionKey(resource: UserCacheResource, accountId: string): string {
    return `user:ver:${resource}:${accountId}`;
  }

  private async version(resource: UserCacheResource, accountId: string): Promise<string> {
    const v = await this.redis.get(this.versionKey(resource, accountId));
    return v ?? '0';
  }

  private async key(
    resource: UserCacheResource,
    accountId: string,
    parts: string,
  ): Promise<string> {
    const v = await this.version(resource, accountId);
    return `user:${resource}:${accountId}:v${v}:${parts}`;
  }

  async get<T>(
    resource: UserCacheResource,
    accountId: string,
    parts = '',
  ): Promise<T | null> {
    try {
      const raw = await this.redis.get(await this.key(resource, accountId, parts));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.logger.warn(`User cache get failed for ${resource}`, error as Error);
      return null;
    }
  }

  async set<T>(
    resource: UserCacheResource,
    accountId: string,
    parts: string,
    value: T,
  ): Promise<void> {
    try {
      await this.redis.set(
        await this.key(resource, accountId, parts),
        JSON.stringify(value),
        'EX',
        this.ttl[resource],
      );
    } catch (error) {
      this.logger.warn(`User cache set failed for ${resource}`, error as Error);
    }
  }

  /**
   * Drops all cached entries of the given resource(s) for ONE account by bumping
   * that account's version. Other accounts are untouched.
   *
   * `location` and `locations` are bumped together whenever either is passed,
   * because a change to a location invalidates both its own detail and the list
   * it appears in — forgetting one is how a deleted location keeps showing up.
   */
  async invalidate(accountId: string, ...resources: UserCacheResource[]): Promise<void> {
    const expanded = new Set<UserCacheResource>(resources);
    if (expanded.has('location') || expanded.has('locations')) {
      expanded.add('location');
      expanded.add('locations');
    }
    try {
      await Promise.all(
        [...expanded].map((r) => this.redis.incr(this.versionKey(r, accountId))),
      );
    } catch (error) {
      this.logger.warn(`User cache invalidate failed`, error as Error);
    }
  }
}
