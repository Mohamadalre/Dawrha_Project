import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';

/**
 * HTTP Logging Interceptor
 * 
 * Logs all incoming HTTP requests and outgoing responses to API logs
 * Captures:
 * - Request method, path, and query parameters
 * - Request duration
 * - Response status code
 * - Success or error status
 */
@Injectable()
export class LoggerHttpInterceptor implements NestInterceptor {
  private readonly logger = new Logger('API');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { method, url, query, body, ip } = request;
    const startTime = Date.now();

    // Log incoming request
    this.logger.log(
      `→ [${method}] ${url} | IP: ${ip} | Query: ${JSON.stringify(query)}`,
    );

    return next.handle().pipe(
      tap((responseData) => {
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode;

        this.logger.log(
          `← [${method}] ${url} | Status: ${statusCode} | Duration: ${duration}ms | Response: ${JSON.stringify(responseData).substring(0, 100)}`,
        );
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        const statusCode = error.status || 500;

        this.logger.error(
          `✗ [${method}] ${url} | Status: ${statusCode} | Duration: ${duration}ms | Error: ${error.message}`,
        );

        throw error;
      }),
    );
  }
}
