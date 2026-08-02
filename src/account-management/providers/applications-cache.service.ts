import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { Role } from '@src/user/enums/role.enum';

/**
 * Read-through cache for the admin's onboarding-application listings
 * (`GET /account-management/{factory|institution|external-partner}`).
 *
 * These lists are hit constantly by the review screen while the underlying rows
 * change only when someone acts on an application, so they cache extremely well.
 *
 * Invalidation uses the same **version counter** trick as `CatalogCacheService`:
 * every key embeds the current version (`applications:<role>:v<N>:<parts>`), so
 * `invalidate(role)` is a single `INCR` — O(1), no `SCAN`/`KEYS`. Every
 * previously cached page becomes unreachable at once and expires on its own TTL,
 * and the next request repopulates from the database (cache-aside).
 *
 * Fail-open by design: any Redis problem falls through to the database rather
 * than failing the request.
 */
@Injectable()
export class ApplicationsCacheService {
  private readonly logger = new Logger(ApplicationsCacheService.name);

  /**
   * Short TTL (2 min): the version counter already guarantees correctness on
   * every mutation WE make, and the TTL is only a safety net for changes that
   * bypass the service (a manual DB edit, another process).
   */
  private readonly ttlSeconds = 120;

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  private versionKey(role: Role): string {
    return `applications:ver:${role}`;
  }

  private async version(role: Role): Promise<string> {
    const v = await this.redis.get(this.versionKey(role));
    return v ?? '0';
  }

  /** `parts` identifies the exact query (page/limit/status). */
  private async key(role: Role, parts: string): Promise<string> {
    return `applications:${role}:v${await this.version(role)}:${parts}`;
  }

  async get<T>(role: Role, parts: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(await this.key(role, parts));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.logger.warn(`Applications cache get failed for ${role}`, error as Error);
      return null;
    }
  }

  async set<T>(role: Role, parts: string, value: T): Promise<void> {
    try {
      await this.redis.set(
        await this.key(role, parts),
        JSON.stringify(value),
        'EX',
        this.ttlSeconds,
      );
    } catch (error) {
      this.logger.warn(`Applications cache set failed for ${role}`, error as Error);
    }
  }

  /**
   * Drops every cached page for a role by bumping its version. Called after ANY
   * change that could alter a listing: an admin decision, a document review, or
   * an applicant correcting their own submission.
   *
   * Passing no role (or an unknown one) invalidates ALL roles — used when the
   * caller only knows that "something changed" (e.g. a media row whose owner
   * role has to be resolved anyway).
   */
  async invalidate(role?: Role): Promise<void> {
    const roles = role
      ? [role]
      : [Role.FACTORY, Role.INSTITUTIONS, Role.EXTERNAL_PARTNER, Role.COLLECTOR];
    try {
      await Promise.all(roles.map((r) => this.redis.incr(this.versionKey(r))));
    } catch (error) {
      this.logger.warn('Applications cache invalidate failed', error as Error);
    }
  }
}
