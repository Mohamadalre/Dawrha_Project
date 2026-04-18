import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

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
            // If data only contains 'message', we can set data to null or leave it as is.
            // Often, we don't want to duplicate the message inside the data payload.
            // But if there's no 'result' property, we preserve the object.
          }
          if ('result' in data) {
            finalData = data.result;
          } else if (Object.keys(data).length === 1 && 'message' in data) {
            // Drop data if it's just exactly the message
            finalData = null;
          }
        }

        return {
          success: true,
          message,
          data: finalData ?? null,
          statusCode,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
