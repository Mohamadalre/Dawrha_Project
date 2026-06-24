import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

export type CacheResource = 'categories' | 'products' | 'offers';

/**
 * Read-through cache for the catalogue listings (categories / products / offers)
 * backed by Redis.
 *
 * Invalidation uses a per-resource **version counter** instead of scanning keys:
 * every cache key embeds the current version (`catalog:<res>:v<N>:<parts>`).
 * `invalidate()` simply `INCR`s the version, so all previously cached keys become
 * unreachable (O(1), no SCAN/KEYS) and expire naturally via their TTL. The next
 * read repopulates the cache (cache-aside) — i.e. the key is effectively dropped
 * on mutation and re-added on the following request.
 *
 * The cache is fail-open: any Redis error falls back to the database.
 */
@Injectable()
export class CatalogCacheService {
  private readonly logger = new Logger(CatalogCacheService.name);

  /** Time-to-live per resource (seconds). */
  private readonly ttl: Record<CacheResource, number> = {
    categories: 12 * 60 * 60, // 12h — changes rarely
    products: 12 * 60 * 60, // 12h
    offers: 6 * 60 * 60, // 6h — more volatile
  };

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  private versionKey(resource: CacheResource): string {
    return `catalog:ver:${resource}`;
  }

  private async version(resource: CacheResource): Promise<string> {
    const v = await this.redis.get(this.versionKey(resource));
    return v ?? '0';
  }

  private async key(resource: CacheResource, parts: string): Promise<string> {
    const v = await this.version(resource);
    return `catalog:${resource}:v${v}:${parts}`;
  }

  async get<T>(resource: CacheResource, parts: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(await this.key(resource, parts));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.logger.warn(`Cache get failed for ${resource}`, error as Error);
      return null;
    }
  }

  async set<T>(resource: CacheResource, parts: string, value: T): Promise<void> {
    try {
      await this.redis.set(
        await this.key(resource, parts),
        JSON.stringify(value),
        'EX',
        this.ttl[resource],
      );
    } catch (error) {
      this.logger.warn(`Cache set failed for ${resource}`, error as Error);
    }
  }

  /** Drops all cached entries for the given resource(s) by bumping the version. */
  async invalidate(...resources: CacheResource[]): Promise<void> {
    try {
      await Promise.all(resources.map((r) => this.redis.incr(this.versionKey(r))));
    } catch (error) {
      this.logger.warn(`Cache invalidate failed`, error as Error);
    }
  }
}
