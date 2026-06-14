import { MailerModule } from "@nestjs-modules/mailer";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MailService } from "./mail.service";
import { BullModule } from "@nestjs/bullmq";
import { MailProcessor } from "./processors/mail.processor";
import { join } from "path";
import { EjsAdapter } from "@nestjs-modules/mailer/adapters/ejs.adapter";
import { MAIL_QUEUE_NAME } from "./queues/mail.queue";



@Module({
  imports: [
    BullModule.registerQueue({
      name: MAIL_QUEUE_NAME,
      defaultJobOptions: {
        removeOnFail: 500
      }
    }),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get('MAIL_HOST'),
          port: config.get('MAIL_PORT'),
          secure: false,
          auth: {
            user: config.get('MAIL_USER'),
            pass: config.get('MAIL_PASS'),
          },
        },
        template: {
          dir: join(__dirname, 'templates'),
          adapter: new EjsAdapter({
            inlineCssEnabled: true
          })
        },
        defaults: {
          from: config.get('MAIL_FROM'),

        },

      }),
    }),
  ],
  controllers: [],
  providers: [MailService, MailProcessor],
  exports: [MailService],
})
export class MailModule { }