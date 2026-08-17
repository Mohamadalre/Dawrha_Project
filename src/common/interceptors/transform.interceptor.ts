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
    // The authenticated account's chosen language wins over any header, so a
    // signed-in user gets every response in their saved language without ever
    // sending one. Guests fall back to the header/default (inside translateMessage).
    const userLang = ctx.getRequest()?.user?.language as string | undefined;

    return next.handle().pipe(
      map((data) => {
        let finalData: any = data;
        let message = 'OPERATION_SUCCESS';

        // Response convention (single source of truth):
        //   { message, result }  → message extracted, data = result
        //   { message }          → message extracted, data = null
        //   { message, ...rest } → message extracted, data = rest (never leaked)
        //   anything else        → data = value as-is
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          if ('message' in data) {
            message = (data as any).message;
          }
          if ('result' in data) {
            finalData = (data as any).result;
          } else if ('message' in data) {
            const { message: _extracted, ...rest } = data as Record<string, unknown>;
            finalData = Object.keys(rest).length ? rest : null;
          }
        }

        return {
          success: true,
          message: translateMessage(message, context, userLang),
          data: finalData ?? null,
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
export function translateMessage(
  message: unknown,
  context?: ExecutionContext,
  langOverride?: string,
): string {
  if (typeof message !== 'string' || !message) return (message as string) ?? '';
  const i18n = context ? I18nContext.current(context) : I18nContext.current();
  if (!i18n) return message;

  const key = `translation.${message}`;
  // The account's saved language, when signed in, takes precedence over the
  // language the header/query resolvers picked.
  const translated = langOverride ? i18n.t(key, { lang: langOverride }) : i18n.t(key);
  return typeof translated === 'string' && translated !== key ? translated : message;
}
