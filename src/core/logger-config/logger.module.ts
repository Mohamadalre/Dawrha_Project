import { Global, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { MorganMiddleware } from './morgan.middleware';
import { winstonConfig } from './winston.config';

@Global()
@Module({
  imports: [WinstonModule.forRoot(winstonConfig)],
  providers: [MorganMiddleware],
  exports: [WinstonModule],
})
export class LoggerModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Express 5 / path-to-regexp v8 require named wildcards ('*' is invalid).
    // '{*path}' is the catch-all that matches every route (incl. root).
    consumer.apply(MorganMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
