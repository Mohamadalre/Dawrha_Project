import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { I18nContext } from 'nestjs-i18n';

/**
 * Global exception filter for handling all unhandled exceptions
 * Catches HttpException and generic Error instances
 * Provides standardized error response format with proper status codes and messages
 * Handles validation errors from class-validator with detailed error messages
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  /**
   * Catches and processes exceptions, transforming them into standardized HTTP responses
   *
   * @param exception - The caught exception (HttpException, Error, or any unknown type)
   * @param host - ArgumentsHost for accessing HTTP context (request, response)
   */
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal Server Error';

    // Handle NestJS HttpException instances
    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse() as any;

      // Handle class-validator validation errors (typically 400 Bad Request)
      // class-validator returns an array of error messages
      if (
        statusCode === HttpStatus.BAD_REQUEST &&
        typeof exceptionResponse === 'object' &&
        Array.isArray(exceptionResponse.message)
      ) {
        // Join all validation error messages into a single string
        message = exceptionResponse.message.join(', ');
      } else if (typeof exceptionResponse === 'object' && exceptionResponse.message) {
        // Handle both array and string message formats
        message = Array.isArray(exceptionResponse.message)
          ? exceptionResponse.message.join(', ')
          : exceptionResponse.message;
      } else if (typeof exceptionResponse === 'string') {
        // Handle string response messages
        message = exceptionResponse;
      } else {
        // Fallback to exception message
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      // Handle generic Error instances
      message = exception.message;
    }

    // Send standardized error response (message translated to the request language)
    response.status(statusCode).json({
      success: false,
      message: this.translate(message),
      data: '',
      statusCode,
      timestamp: new Date().toISOString(),
    });
  }

  /** Translates an error message via i18n; falls back to the original literal. */
  private translate(message: string): string {
    const i18n = I18nContext.current();
    if (!i18n || typeof message !== 'string') return message;
    const key = `translation.${message}`;
    const t = i18n.t(key);
    return typeof t === 'string' && t !== key ? t : message;
  }
}
