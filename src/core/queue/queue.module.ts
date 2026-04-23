import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BullModule} from "@nestjs/bullmq";

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
         }
        })
    })
],

    exports: [],
})
export class QueueModule { }