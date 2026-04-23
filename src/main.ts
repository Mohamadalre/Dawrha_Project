import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ClassSerializerInterceptor, ValidationPipe, VersioningType } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { winstonConfig } from './core/logger-config/logger.config';
import { LoggerExceptionsFilter } from './common/filters/logger-exception.filter';

async function bootstrap() {
  const logger = WinstonModule.createLogger(winstonConfig);
  dotenv.config();
  const port = process.env.PORT || 3000;
  try {
    const app = await NestFactory.create(AppModule, { logger
      ,bufferLogs:true
     });
       //app.useLogger(logger);



    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI })
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new LoggerExceptionsFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    app.useGlobalFilters(new AllExceptionsFilter());

  
    await app.listen(port);
console.log("gggggggggg");

    logger.log(`Server is running on port ${port}`, 'SYSTEM')

  } catch (error: any) {
    logger.error(`Critical System Failure : ${error.message}`, error.stack, 'SYSTEM');
    console.log(`error ${error}`);
    
    process.exit(1)
  }
}
bootstrap();
