import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { I18nContext } from 'nestjs-i18n';

export interface StandardResponse<T> {
  success: boolean;
  message: string;
  data: T;
  statusCode: number;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, StandardResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<StandardResponse<T>> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse();
    const statusCode = response.statusCode;

    return next.handle().pipe(
      map((data) => {
        let finalData = data;
        let message = 'OPERATION_SUCCESS';

        if (data && typeof data === 'object') {
          if ('message' in data) {
            message = data.message;
          }
          if ('result' in data) {
            finalData = data.result;
          } else if (Object.keys(data).length === 1 && 'message' in data) {
            finalData = null;
          }
        }

        return {
          success: true,
          message: translateMessage(message, context),
          data: finalData ?? '',
          statusCode,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}

/**
 * Translates a response message to the request's language. The message is used
 * as an i18n key under the `translation` namespace; if no translation exists
 * (or no i18n context), the original message is returned unchanged — so every
 * route is translatable without breaking ones that aren't keyed yet.
 */
export function translateMessage(message: unknown, context?: ExecutionContext): string {
  if (typeof message !== 'string' || !message) return (message as string) ?? '';
  const i18n = context ? I18nContext.current(context) : I18nContext.current();
  if (!i18n) return message;

  const key = `translation.${message}`;
  const translated = i18n.t(key);
  return typeof translated === 'string' && translated !== key ? translated : message;
}
