import { Inject, Injectable } from "@nestjs/common";
import { RedisType } from "@src/common/utils/types/redis.type";
import Redis from "ioredis";

@Injectable()
export class RedisService {
    constructor(
        @Inject('REDIS_CLIENT') private readonly redis: Redis
    ) { }

    async clearByKey(key: string): Promise<void> {
        await this.redis.del(key);
    }


    async getRedisByKey(key:string): Promise<string | null> {
    return await this.redis.get(key);
  }

  async setRedisKey({redisKey,redisValue,date}:RedisType) : Promise<void>{
        await this.redis.set(redisKey,redisValue,'EX',date);
  }
}     