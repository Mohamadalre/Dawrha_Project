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
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            logger.warn(`Queue Redis retry attempt ${times}, waiting ${delay}ms`);
            return delay;
          },
         }
        })
    })
],

    exports: [],
})
export class QueueModule { }