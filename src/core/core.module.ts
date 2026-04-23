import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { MailModule }  from './mail/mail.module' 
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    MailModule,
    QueueModule
  ],
})
export class CoreModule {}
