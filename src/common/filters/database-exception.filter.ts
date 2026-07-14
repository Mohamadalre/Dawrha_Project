import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Logger,
} from '@nestjs/common';

import { QueryFailedError } from 'typeorm';

/**
 * Exception filter for handling database-related errors
 * Specifically catches QueryFailedError from TypeORM and provides user-friendly messages
 * Handles common PostgreSQL error codes like unique violations, foreign key constraints, not null violations
 * Transforms technical database errors into readable HTTP responses
 */
@Catch(QueryFailedError)
export class DatabaseExceptionFilter
  implements ExceptionFilter
{
  private readonly logger = new Logger('Database');

  /**
   * Catches and processes database query failures with proper error handling
   *
   * @param exception - The QueryFailedError exception with code and detail properties
   * @param host - ArgumentsHost for accessing HTTP context (request, response)
   */
  catch(
    exception: QueryFailedError & {
      code?: string;
      detail?: string;
    },
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let message = 'Database error';

    // Log database connection and query errors
    this.logger.error(
      `Database connection/query error: ${exception.message}`,
      {
        code: exception.code,
        detail: exception.detail,
        query: (exception as any).query,
        parameters: (exception as any).parameters,
        method: request.method,
        path: request.url,
        timestamp: new Date().toISOString(),
      },
    );

    /**
     * PostgreSQL error codes mapping:
     * - 23505: Unique constraint violation
     * - 23503: Foreign key constraint violation
     * - 23502: Not null constraint violation
     */
    switch (exception.code) {
      // UNIQUE VIOLATION - Duplicate entry error
      case '23505':
        // Extract field name from error detail using regex
        // eslint-disable-next-line no-case-declarations
        const detail = exception.detail;
        // Match field name enclosed in parentheses
        // eslint-disable-next-line no-case-declarations
        const match = detail?.match(/\((.*?)\)/);
        // Extract the first matched group (field name)
        // eslint-disable-next-line no-case-declarations
        const field = match?.[1];
        message = `${field} already exists`;
        break;

      // FOREIGN KEY VIOLATION - Referenced record doesn't exist
      case '23503':
        message = 'Related record does not exist';
        break;

      // NOT NULL VIOLATION - Required field is empty
      case '23502':
        message = 'Required field is missing';
        break;

      // Unknown database error
      default:
        message = 'Unexpected database error';
    }

    // Send standardized error response (same unified envelope as AllExceptionsFilter)
    response.status(400).json({
      success: false,
      message,
      errorCode: 'DATABASE_ERROR',
      data: null,
      statusCode: 400,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}