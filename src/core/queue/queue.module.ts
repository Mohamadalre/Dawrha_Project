import { Global, Module, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BullModule} from "@nestjs/bullmq";

const logger = new Logger('Queue');

@Global()
@Module({
    imports: [ 
        BullModule.forRootAsync({
        inject: [ConfigService],
        useFactory:(configService:ConfigService)=>({
         connection:{
          host: configService.get<string>('REDIS_HOST'),
          port: Number(configService.get('REDIS_PORT')) || 6379,
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
          // BullMQ REQUIRES this: workers issue blocking commands (BRPOPLPUSH),
          // and the default retry budget tears the socket down → ECONNRESET loop.
          maxRetriesPerRequest: null,
          // Defensive: TCP keepalive probes every 10s so idle sockets survive
          // Docker Desktop's Windows port proxy (host OS default is 2h).
          keepAlive: 10_000,
          connectTimeout: 10_000,
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            // Docker Desktop's Windows port proxy closes IDLE published-port
            // connections, so each BullMQ connection reconnects periodically
            // and always succeeds on attempt 1. Logging that as a warning
            // buried the real problems in noise, so the routine first attempt
            // is debug-level; anything beyond it means Redis is genuinely
            // unreachable and stays a warning.
            if (times === 1) {
              logger.debug(`Queue Redis reconnecting (routine), waiting ${delay}ms`);
            } else {
              logger.warn(`Queue Redis retry attempt ${times}, waiting ${delay}ms`);
            }
            return delay;
          },
         }
        })
    })
],

    exports: [],
})
export class QueueModule { }