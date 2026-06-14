import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import * as crypto from 'crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  MAIL_QUEUE_NAME,
  MAIL_SEND_OTP_JOB_NAME,
  MAIL_SEND_RESET_LINK_JOB_NAME,
  MAIL_MAX_ATTEMPTS,
  MAIL_BACKOFF_DELAY_MS,
} from './queues/mail.queue';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @InjectQueue(MAIL_QUEUE_NAME) private mailQueue: Queue,
    private readonly configService: ConfigService,
  ) { }

  private hash(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  async generateAndSendOtp(email: string) {
    const otp = Math.floor(10000 + Math.random() * 90000).toString();
    const hashed = this.hash(otp);
    const redisKey = `otp:${email}`;
    console.log(otp);

    try {
      await this.redis.set(redisKey, hashed, 'EX', 600);
      await this.redis.set(`otp:cooldown:${email}`, 'locked', 'EX', 60)
      await this.mailQueue.add(MAIL_SEND_OTP_JOB_NAME, {
        email,
        otp
      }, {
        
        attempts: MAIL_MAX_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay:MAIL_BACKOFF_DELAY_MS},
        removeOnComplete: true,

      })
      this.logger.log(`OTP generated and queue task added for :${email}`)

    } catch (error:any) {
      this.logger.log(`Failed to generate of queue OTP : ${error.message}`)

      await this.redis.del(redisKey);
      throw error;
    }
  }

  async generateAndSendTokenUrl(email: string, userId: string) {
    const tokenUrl = crypto.randomBytes(32).toString('hex')
    const redisKey = `reset:${tokenUrl}`;

    const link = `${this.configService.get<string>('FRONTEND_URL')}?token=${tokenUrl}`
    console.log(tokenUrl);

    try {
      await this.redis.set(redisKey, userId, 'EX', 600);
      await this.redis.set(`tokenUrl:cooldown:${email}`, 'locked', 'EX', 60)
      await this.mailQueue.add(MAIL_SEND_RESET_LINK_JOB_NAME, {
        email,
        link
      }, {
        attempts: MAIL_MAX_ATTEMPTS,
        backoff: {
          type:'exponential',
          delay: MAIL_BACKOFF_DELAY_MS
        },
        removeOnComplete: true,

      })
      this.logger.log(`TokenURL generated and queue task added for :${email}`)
    } catch (error:any) {
      this.logger.log(`Failed to generate of queue TokenURL : ${error.message}`)

      await this.redis.del(redisKey);
      throw error;
    }
  }

  async verifyOtp(email: string, inputOtp: string): Promise<boolean> {
    const storedOtp = await this.redis.get(`otp:${email}`);
    if (!storedOtp) return false;
    const hashedInput = this.hash(inputOtp)
    if (hashedInput === storedOtp) {
      await this.clearOtp(email);
      return true;
    }
    return false;
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
