import { Injectable, Inject, Logger } from '@nestjs/common';
import { InternalServerErrorException } from '@nestjs/common';
import Redis from 'ioredis';
import * as crypto from 'crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name)
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @InjectQueue('mail-queue') private mailQueue: Queue
  ) { }

  private hash(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  async generateAndSendOtp(email: string) {
    const otp = Math.floor(10000 + Math.random() * 90000).toString();
    const hashed = this.hash(otp);
    const redisKey = `otp:${email}`;

    try {
      await this.redis.set(redisKey, hashed, 'EX', 300);
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

  async verifyOtp(email: string, inputOtp: string): Promise<boolean> {
    const storedOtp = await this.redis.get(`otp:${email}`);
    if (!storedOtp) return false;
    if (this.hash(inputOtp) === storedOtp) {
      await this.clearOtp(email);
      return true;
    }
    return false;
  }

  async clearOtp(email: string): Promise<void> {
    await this.redis.del(`otp:${email}`);
  }
}
