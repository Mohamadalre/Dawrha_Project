import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import Redis from 'ioredis';
import * as crypto from 'crypto';

/** OTP policy (single source of truth). */
export const OTP_TTL_SECONDS = 600; // code lifetime: 10 min
export const OTP_COOLDOWN_SECONDS = 120; // min gap between sends
export const OTP_MAX_ATTEMPTS = 5; // wrong tries before lockout
export const OTP_MAX_DAILY_RESENDS = 10; // resend cap per email per day

import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  MAIL_QUEUE_NAME,
  MAIL_SEND_OTP_JOB_NAME,
  MAIL_SEND_FORGOT_OTP_JOB_NAME,
  MAIL_MAX_ATTEMPTS,
  MAIL_BACKOFF_DELAY_MS,
} from './queues/mail.queue';
import { winstonLogger } from '../logger-config/winston.config';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @InjectQueue(MAIL_QUEUE_NAME) private mailQueue: Queue,
    private readonly configService: ConfigService,
  ) { }

   hash(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  async generateAndSendOtp(email: string) {
    // Cryptographically secure 5-digit code (not Math.random).
    const otp = crypto.randomInt(10000, 100000).toString();
    const hashed = this.hash(otp);
    const redisKey = `otp:${email}`;
    const cooldownKey = `otp:cooldown:${email}`;

    try {
      await this.redis.set(redisKey, hashed, 'EX', OTP_TTL_SECONDS);
      await this.redis.set(cooldownKey, 'locked', 'EX', OTP_COOLDOWN_SECONDS);
      // A freshly issued code resets the wrong-attempt counter.
      await this.redis.del(`otp:attempts:${email}`);
      await this.mailQueue.add(MAIL_SEND_OTP_JOB_NAME, {
        email,
        otp
      }, {

        attempts: MAIL_MAX_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: MAIL_BACKOFF_DELAY_MS
        },
        removeOnComplete: true,

      })
      this.logger.log(`OTP generated and queue task added for :${email}`)

    } catch (error: any) {
      this.logger.log(`Failed to generate of queue OTP : ${error.message}`)

      // Roll back BOTH keys so the user isn't cooled-down without a valid code.
      await this.redis.del(redisKey);
      await this.redis.del(cooldownKey);
      throw error;
    }
  }

  async generateAndSendOtpForgot(email: string) {
    const otp = Math.floor(10000 + Math.random() * 90000).toString();
    const hashed = this.hash(otp);
    const redisKey = `forgotPassword:Otp${email}`;

    try {
      await this.redis.set(redisKey, hashed, 'EX', 600);
      await this.redis.del(`forgotPassword:attempts:${email}`);
      await this.mailQueue.add(MAIL_SEND_FORGOT_OTP_JOB_NAME, {
        email,
        otp
      }, {
        attempts: MAIL_MAX_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: MAIL_BACKOFF_DELAY_MS
        },
        removeOnComplete: true,

      })

      winstonLogger.info(`OTP for forgot password generated and queue task added for :${email}`, {
        context: 'send otp ',
        channel: 'app',
        metadata: {
          task: 'auth',
        },
      });
    } catch (error: any) {
      winstonLogger.error(`Failed to generate or queue OTP for forgot password : ${error.message}`, {
        context: 'send otp',
        channel: 'app',
        stack: error?.stack,
        metadata: {
          message: error?.message,
        },
      });

      await this.redis.del(redisKey);
      throw error;
    }
  }

  async verifyOtp(email: string, inputOtp: string): Promise<boolean> {
    const attemptsKey = `otp:attempts:${email}`;

    // Brute-force guard: lock after too many wrong tries.
    const attempts = Number((await this.redis.get(attemptsKey)) ?? 0);
    if (attempts >= OTP_MAX_ATTEMPTS) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many invalid attempts. Please request a new code.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const storedOtp = await this.redis.get(`otp:${email}`);
    if (!storedOtp) return false;

    const hashedInput = this.hash(inputOtp);
    const match =
      hashedInput.length === storedOtp.length &&
      crypto.timingSafeEqual(Buffer.from(hashedInput), Buffer.from(storedOtp));

    if (match) {
      await this.clearOtp(email);
      await this.redis.del(attemptsKey);
      return true;
    }

    await this.redis.incr(attemptsKey);
    await this.redis.expire(attemptsKey, OTP_TTL_SECONDS);
    return false;
  }

  async verifyResetOtp(email: string, inputOtp: string): Promise<boolean> {
    const storedOtp = await this.redis.get(`forgotPassword:Otp${email}`);
    if (!storedOtp) throw new BadRequestException('OTP has expired or is invalid. Please request a new one.');
    const hashedInput = this.hash(inputOtp)
    if (hashedInput !== storedOtp) {
      await this.redis.incr(`forgotPassword:attempts:${email}`);
      await this.redis.expire(`forgotPassword:attempts:${email}`, 600); // Set expiration for attempts key
      throw new BadRequestException('Invalid OTP. Please try again.');
    }
      await this.redis.del(`forgotPassword:Otp${email}`);
      await this.redis.del(`forgotPassword:attempts:${email}`);
      return true;
    }


  async clearOtp(email: string): Promise<void> {
    await this.redis.del(`otp:${email}`);
  }

  async getRedisByKey(key: string): Promise<string | null> {
    return await this.redis.get(key);
  }

  async clearByKey(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
