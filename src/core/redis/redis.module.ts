import { Module, Global, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('Redis');
        const redis = new Redis({
          host: configService.get<string>('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT'),
          password: configService.get<string>('REDIS_PASSWORD'),
          // Defensive: TCP keepalive probes every 10s so idle sockets survive
          // Docker Desktop's Windows port proxy (host OS default is 2h).
          keepAlive: 10_000,
          connectTimeout: 10_000,
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
        });

        redis.on('error', (err) => {
          logger.error(`Redis connection error: ${err.message}`, err.stack);
        });

        redis.on('connect', () => {
          logger.log('Redis connected successfully');
        });

        redis.on('reconnecting', () => {
          logger.warn('Redis reconnecting...');
        });

        return redis;
      },
    },
    RedisService
  ],
  exports: ['REDIS_CLIENT',RedisService],
})
export class RedisModule {}
