import { HttpException } from '@nestjs/common';
import { AuthService } from './auth.service';


/**
 * Unit tests for the OTP resend policy (cooldown + daily cap) in AuthService.
 * Only the collaborators used by resendOtpCode are given real mocks.
 */
describe('AuthService.resendOtpCode', () => {
  let service: AuthService;
  let userService: any;
  let redis: any;
  let mailService: any;

  const build = () => {
    userService = { findById: jest.fn().mockResolvedValue({ id: 'u1', email: 'u@e.com' }) };
    redis = { ttl: jest.fn(), incr: jest.fn(), expire: jest.fn().mockResolvedValue(1) };
    mailService = { generateAndSendOtp: jest.fn().mockResolvedValue(undefined) };

    // Remaining 11 constructor deps are unused by resendOtpCode.
    const noop: any = {};
    return new AuthService(
      userService, // userService
      noop, // jwtService
      noop, // configService
      noop, // redisService
      noop, // userDeviceRepository
      noop, // accountRepository
      redis, // REDIS_CLIENT
      mailService, // mailService
      noop, noop, noop, noop, noop, noop, noop, // 7 login handlers
    );
  };

  beforeEach(() => {
    service = build();
  });

  it('throws 429 while the cooldown is still active and does not resend', async () => {
    redis.ttl.mockResolvedValue(45); // 45s left

    await expect(service.resendOtpCode('u1')).rejects.toBeInstanceOf(HttpException);
    expect(mailService.generateAndSendOtp).not.toHaveBeenCalled();
  });

  it('throws 429 when the daily resend cap is exceeded', async () => {
    redis.ttl.mockResolvedValue(-2); // no cooldown
    redis.incr.mockResolvedValue(11); // over the 10/day cap

    await expect(service.resendOtpCode('u1')).rejects.toBeInstanceOf(HttpException);
    expect(mailService.generateAndSendOtp).not.toHaveBeenCalled();
  });

  it('resends and returns the cooldown when allowed', async () => {
    redis.ttl.mockResolvedValue(-2);
    redis.incr.mockResolvedValue(1); // first resend today

    const res = await service.resendOtpCode('u1');

    expect(redis.expire).toHaveBeenCalledWith('otp:resend:count:u@e.com', 86400);
    expect(mailService.generateAndSendOtp).toHaveBeenCalledWith('u@e.com');
    expect(res.cooldownSeconds).toBe(120);
  });
});
