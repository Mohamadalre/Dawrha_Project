import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { I18nContext } from 'nestjs-i18n';

/**
 * Generic translations for class-validator's default English messages (which
 * embed the field name, so they can't be plain dictionary keys). Applied only
 * for Arabic, after the dictionary lookup fails.
 */
const VALIDATION_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^property (.+) should not exist$/, (m) => `الحقل ${m[1]} غير مسموح به`],
  [/^each value in (.+) must be a UUID$/, (m) => `كل قيمة في ${m[1]} يجب أن تكون معرّفًا صالحًا`],
  [/^(.+) must be a string$/, (m) => `حقل ${m[1]} يجب أن يكون نصًا`],
  [/^(.+) must be an email$/, () => `صيغة البريد الإلكتروني غير صحيحة`],
  [/^(.+) must be a UUID$/, (m) => `حقل ${m[1]} يجب أن يكون معرّفًا صالحًا`],
  [/^(.+) must be a boolean value$/, (m) => `حقل ${m[1]} يجب أن يكون قيمة منطقية`],
  [/^(.+) must be a number.*$/, (m) => `حقل ${m[1]} يجب أن يكون رقمًا`],
  [/^(.+) must be an integer.*$/, (m) => `حقل ${m[1]} يجب أن يكون رقمًا صحيحًا`],
  [/^(.+) must be an array$/, (m) => `حقل ${m[1]} يجب أن يكون مصفوفة`],
  [/^(.+) should not be empty$/, (m) => `حقل ${m[1]} مطلوب`],
  [/^(.+) must be longer than or equal to (\d+) characters$/, (m) => `حقل ${m[1]} يجب ألا يقل عن ${m[2]} حرفًا`],
  [/^(.+) must be shorter than or equal to (\d+) characters$/, (m) => `حقل ${m[1]} يجب ألا يزيد عن ${m[2]} حرفًا`],
  [/^(.+) must contain at least (\d+) elements$/, (m) => `حقل ${m[1]} يجب أن يحتوي ${m[2]} عنصرًا على الأقل`],
];

function translateValidationPattern(message: string): string {
  for (const [re, fn] of VALIDATION_PATTERNS) {
    const match = message.match(re);
    if (match) return fn(match);
  }
  return message;
}

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
        // Translate each validation message individually, then join — otherwise
        // the joined string never matches a translation key.
        message = exceptionResponse.message
          .map((m: string) => this.translate(m))
          .join(', ');
      } else if (typeof exceptionResponse === 'object' && exceptionResponse.message) {
        // Handle both array and string message formats
        message = Array.isArray(exceptionResponse.message)
          ? exceptionResponse.message.map((m: string) => this.translate(m)).join(', ')
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

  /**
   * Translates an error message: first via the i18n dictionary (key = message),
   * then (for Arabic only) via generic class-validator patterns; otherwise
   * returns the original literal.
   */
  private translate(message: string): string {
    if (typeof message !== 'string' || !message) return message;
    const i18n = I18nContext.current();
    if (i18n) {
      const key = `translation.${message}`;
      const t = i18n.t(key);
      if (typeof t === 'string' && t !== key) return t;
    }
    const lang = i18n?.lang;
    if (lang && lang.toLowerCase().startsWith('ar')) {
      return translateValidationPattern(message);
    }
    return message;
  }
}
