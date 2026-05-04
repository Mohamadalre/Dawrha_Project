import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import * as crypto from 'crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @InjectQueue('mail-queue') private mailQueue: Queue,
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
      await this.mailQueue.add('send-otp', {
        email,
        otp
      }, {
        attempts: 3,
        backoff: 5000,
        removeOnComplete: true,

      })
      this.logger.log(`OTP generated and queue task added for :${email}`)

    } catch (error) {
      this.logger.log(`Failed to generate of queue OTP : ${error.message}`)

      await this.redis.del(redisKey);
      throw error;
    }
  }

  async generateAndSendTokenUrl(email: string, userId: string) {
    const tokenUrl = crypto.randomBytes(32).toString('hex')
    const redisKey = `reset:${tokenUrl}`;

    const link = `${this.configService.get<string>('SEVER_HOST')}:${this.configService.get<number>('PORT')}/v1/auth/reset-password?token=${tokenUrl}`
    console.log(tokenUrl);

    try {
      await this.redis.set(redisKey, userId, 'EX', 600);
      await this.redis.set(`tokenUrl:cooldown:${email}`, 'locked', 'EX', 60)
      await this.mailQueue.add('send-reset-link', {
        email,
        link
      }, {
        attempts: 3,
        backoff: 5000,
        removeOnComplete: true,

      })
      this.logger.log(`TokenURL generated and queue task added for :${email}`)
    } catch (error) {
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
