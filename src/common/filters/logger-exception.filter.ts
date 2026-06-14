import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { winstonLogger } from '@src/core/logger-config/winston.config';

@Catch()
export class LoggerExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const errorMessage = typeof exception === 'string'
      ? exception
      : exception instanceof Error
      ? exception.message
      : exception != null
      ? JSON.stringify(exception)
      : 'Unknown exception';
    const stack = exception instanceof Error ? exception.stack : undefined;

    winstonLogger.error(errorMessage, {
      context: 'LoggerExceptionsFilter',
      channel: 'app',
      stack,
      metadata: {
        statusCode: status,
        path: request.url,
        method: request.method,
        body: request.body,
        exception,
      },
    });

    response.status(status).json({
      success: false,
      message: 'Internal server error occurred',
    });
  }
}