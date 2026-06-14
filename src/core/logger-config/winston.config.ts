import * as fs from 'fs';
import * as path from 'path';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

const LOGS_DIR = path.resolve(process.cwd(), 'logs');

const ensureDirectory = (directory: string) => {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
};

['combined', 'errors', 'exceptions', 'api', 'app', 'jobs'].forEach((subdir) =>
  ensureDirectory(path.join(LOGS_DIR, subdir)),
);

type WinstonLogEntry = winston.Logform.TransformableInfo & {
  context?: string;
  channel?: string;
  metadata?: Record<string, unknown>;
  stack?: string;
};

const productionFileFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.timestamp(),
  winston.format.metadata({ fillExcept: ['timestamp', 'level', 'message', 'context', 'channel', 'stack'] }),
  winston.format((info: winston.Logform.TransformableInfo) => {
    const entry = info as WinstonLogEntry;
    entry.context = entry.context || entry.channel || 'System';
    return entry;
  })(),
  winston.format.json(),
);

const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info: winston.Logform.TransformableInfo) => {
    const entry = info as WinstonLogEntry;
    const timestamp = typeof entry.timestamp === 'string'
      ? entry.timestamp
      : entry.timestamp != null
      ? JSON.stringify(entry.timestamp)
      : '';
    const level = typeof entry.level === 'string' ? entry.level : String(entry.level || '');
    const message = typeof entry.message === 'string'
      ? entry.message
      : entry.message != null
      ? JSON.stringify(entry.message)
      : '';
    const context = typeof entry.context === 'string' ? entry.context : String(entry.context || 'System');
    const stack = typeof entry.stack === 'string' ? entry.stack : String(entry.stack || '');
    const metadata = entry.metadata || {};
    const metadataJson = Object.keys(metadata).length ? ` metadata=${JSON.stringify(metadata)}` : '';
    const contextLabel = `[${context}]`;
    const stackMessage = stack ? `\n${stack}` : '';
    return `${timestamp} ${contextLabel} ${level}: ${message}${metadataJson}${stackMessage}`;
  }),
);

const filterByChannel = (channel: string) =>
  winston.format((info: winston.Logform.TransformableInfo) => {
    const entry = info as WinstonLogEntry;
    return entry.channel === channel ? entry : false;
  })();

const filterExcludeChannels = (channels: string[]) =>
  winston.format((info: winston.Logform.TransformableInfo) => {
    const entry = info as WinstonLogEntry;
    return channels.includes(entry.channel || '') ? false : entry;
  })();

const filterStatusError = winston.format((info: winston.Logform.TransformableInfo) => {
  const entry = info as WinstonLogEntry;
  return entry.level === 'error' || entry.level === 'fatal' ? entry : false;
})();

const exceptionTransport = new winston.transports.DailyRotateFile({
  dirname: path.join(LOGS_DIR, 'exceptions'),
  filename: 'exceptions-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '10d',
  maxSize: '20m',
  zippedArchive: true,
  level: 'error',
  format: productionFileFormat,
});

export const winstonConfig = {
  level: 'silly',
  exitOnError: false,
  format: productionFileFormat,
  transports: [
    new winston.transports.Console({
      level: 'silly',
      format: consoleFormat,
      silent: process.env.NODE_ENV === 'production',
    }),

    new winston.transports.DailyRotateFile({
      dirname: path.join(LOGS_DIR, 'combined'),
      filename: 'combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '10d',
      maxSize: '20m',
      zippedArchive: true,
      level: 'silly',
      format: productionFileFormat,
      handleExceptions: false,
      handleRejections: false,
    }),

    new winston.transports.DailyRotateFile({
      dirname: path.join(LOGS_DIR, 'app'),
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '10d',
      maxSize: '20m',
      zippedArchive: true,
      level: 'info',
      format: winston.format.combine(filterExcludeChannels(['api', 'jobs']), productionFileFormat),
      handleExceptions: false,
      handleRejections: false,
    }),

    new winston.transports.DailyRotateFile({
      dirname: path.join(LOGS_DIR, 'api'),
      filename: 'api-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '10d',
      maxSize: '20m',
      zippedArchive: true,
      level: 'info',
      format: winston.format.combine(filterByChannel('api'), productionFileFormat),
      handleExceptions: false,
      handleRejections: false,
    }),

    new winston.transports.DailyRotateFile({
      dirname: path.join(LOGS_DIR, 'jobs'),
      filename: 'jobs-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '10d',
      maxSize: '20m',
      zippedArchive: true,
      level: 'info',
      format: winston.format.combine(filterByChannel('jobs'), productionFileFormat),
      handleExceptions: false,
      handleRejections: false,
    }),

    new winston.transports.DailyRotateFile({
      dirname: path.join(LOGS_DIR, 'errors'),
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '10d',
      maxSize: '20m',
      zippedArchive: true,
      level: 'error',
      format: winston.format.combine(filterStatusError, productionFileFormat),
      handleExceptions: false,
      handleRejections: false,
    }),
  ],
  exceptionHandlers: [exceptionTransport],
  rejectionHandlers: [exceptionTransport],
};

export const winstonLogger = winston.createLogger(winstonConfig as winston.LoggerOptions);
