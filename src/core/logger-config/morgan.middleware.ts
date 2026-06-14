import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import morgan from 'morgan';
import { winstonLogger } from './winston.config';

morgan.token('remote-ip', (req: Request) => {
  return (
    req.headers['x-forwarded-for'] as string ||
    req.socket.remoteAddress ||
    req.ip ||
    'unknown'
  );
});

@Injectable()
export class MorganMiddleware implements NestMiddleware {
  private readonly morganInstance = morgan(
    ':remote-ip :method :url :status :response-time ms :res[content-length]',
    {
      stream: {
        write: (message: string) => {
          winstonLogger.info(message.trim(), {
            context: 'API',
            channel: 'api',
            metadata: {
              source: 'morgan',
            },
          });
        },
      },
    },
  );

  use(req: Request, res: Response, next: NextFunction) {
    this.morganInstance(req, res, next);
  }
}
