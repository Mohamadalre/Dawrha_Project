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
          port: configService.get<number>('REDIS_PORT'),
          password: configService.get<string>('REDIS_PASSWORD'),
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