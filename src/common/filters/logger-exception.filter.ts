import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';

@Catch()
export class LoggerExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('API'); 

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status = exception instanceof HttpException 
      ? exception.getStatus() 
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const logMessage = {
      statusCode: status,
      path: request.url,
      method: request.method,
      message: exception instanceof Error ? exception.message : exception,
      timestamp: new Date().toISOString(),
      body: request.body, 
    };

    this.logger.error(JSON.stringify(logMessage));

    response.status(status).json({
      success: false,
      message: 'Internal server error occurred',
    });
  }
}