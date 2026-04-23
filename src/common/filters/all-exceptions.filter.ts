import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal Server Error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse() as any;

      // Class-Validator HTTP Exceptions (usually Bad Request 400)
      if (
        statusCode === HttpStatus.BAD_REQUEST &&
        typeof exceptionResponse === 'object' &&
        Array.isArray(exceptionResponse.message)
      ) {
        // Join all error messages into a single string
        message = exceptionResponse.message.join(', ');
      } else if (typeof exceptionResponse === 'object' && exceptionResponse.message) {
        message = Array.isArray(exceptionResponse.message)
          ? exceptionResponse.message.join(', ')
          : exceptionResponse.message;
      } else if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(statusCode).json({
      success: false,
      message,
      data:'',
      statusCode,
      timestamp: new Date().toISOString(),
    });
  }
}
