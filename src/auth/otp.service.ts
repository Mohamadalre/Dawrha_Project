import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';


@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async generateAndSendOtp(email: string): Promise<string> {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store OTP in Redis with a 5 minutes (300 seconds) expiration limit
    await this.redis.set(`otp:${email}`, otp, 'EX', 300);

    // TODO: Replace with an actual SMS provider
    this.logger.debug(`[MOCK OTP SENDER] - OTP for ${email} is ${otp}`);
    
    return otp;
  }

  async verifyOtp(phone: string, inputOtp: string): Promise<boolean> {
    const storedOtp = await this.redis.get(`otp:${phone}`);
    return storedOtp === inputOtp;
  }

  async clearOtp(phone: string): Promise<void> {
    await this.redis.del(`otp:${phone}`);
  }
}
