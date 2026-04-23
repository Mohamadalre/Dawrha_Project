import * as winston from 'winston';
import 'winston-daily-rotate-file';
import * as path from 'path';

const LOGS_DIR = 'logs';


const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, context }) => {
    return `${timestamp} [${context || 'System'}] ${level}: ${message}`;
  })
);


const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

export const winstonConfig = {
  transports: [

    new winston.transports.Console({
      level:'silly',
      format: consoleFormat,
    }),

  
    new winston.transports.DailyRotateFile({
      filename: path.join(LOGS_DIR, 'api', 'api-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '15d',
      level: 'silly', 
      format: winston.format.combine(
        winston.format((info) => (info.context === 'API' ? info : false))(),
        fileFormat
      ),
    }),


    new winston.transports.DailyRotateFile({
      filename: path.join(LOGS_DIR, 'jobs', 'jobs-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '15d',
      level: 'info', 
      format: winston.format.combine(
        winston.format((info) => (info.context === 'JOBS' ? info : false))(),
        fileFormat
      ),
    }),

    
    new winston.transports.DailyRotateFile({
      filename: path.join(LOGS_DIR, 'system', 'system-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '15d',
      level: 'debug', // سيلتقط info, warn, error
      format: winston.format.combine(
        winston.format((info) => {
          // if (info.context !== 'JOBS') {
           
            
            
            return info;
       
       //    return false;
        })(),
        fileFormat
      ),
    }),
  ],
};