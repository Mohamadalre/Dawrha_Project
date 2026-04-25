import { Inject, Injectable } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class PermissionCacheProvider {
  constructor( 
    @Inject('REDIS_CLIENT') private readonly redis: Redis ) {}

  private key(userId: string) {
    return `perm:${userId}`;
  }

  async get(userId: string): Promise<string[] | null> {
    const data = await this.redis.get(this.key(userId));
    return data ? JSON.parse(data) : null;
  }

  async set(userId: string, permissions: string[]) {
    await this.redis.set(
      this.key(userId),
      JSON.stringify(permissions),
      'EX',
      3600, // 1 hour
    );
  }

  async clear(userId: string) {
    await this.redis.del(this.key(userId));
  }
}