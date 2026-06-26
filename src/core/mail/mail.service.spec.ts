import { HttpException, Logger } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Unit tests for the OTP send/verify hardening.
 */
describe('MailService (OTP)', () => {
  let service: MailService;
  let redis: any;
  let mailQueue: any;
  let configService: any;

  beforeEach(() => {
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };
    mailQueue = { add: jest.fn().mockResolvedValue({ id: 'job1' }) };
    configService = { get: jest.fn() };
    service = new MailService(redis, mailQueue, configService);
  });

  describe('generateAndSendOtp', () => {
    it('issues a secure 5-digit code and queues the email', async () => {
      await service.generateAndSendOtp('user@example.com');

      // otp key (10 min) + cooldown key (120s) + attempts reset
      expect(redis.set).toHaveBeenCalledWith('otp:user@example.com', expect.any(String), 'EX', 600);
      expect(redis.set).toHaveBeenCalledWith('otp:cooldown:user@example.com', 'locked', 'EX', 120);
      expect(redis.del).toHaveBeenCalledWith('otp:attempts:user@example.com');

      const queuedOtp = mailQueue.add.mock.calls[0][1].otp;
      expect(queuedOtp).toMatch(/^\d{5}$/); // exactly 5 digits
    });

    it('rolls back the otp AND cooldown keys when queuing fails', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      mailQueue.add.mockRejectedValueOnce(new Error('queue down'));

      await expect(service.generateAndSendOtp('user@example.com')).rejects.toThrow('queue down');
      expect(redis.del).toHaveBeenCalledWith('otp:user@example.com');
      expect(redis.del).toHaveBeenCalledWith('otp:cooldown:user@example.com');
    });
  });

  describe('verifyOtp', () => {
    it('returns true and clears state on a correct code', async () => {
      const stored = service.hash('12345');
      redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(stored); // attempts, otp

      await expect(service.verifyOtp('u@e.com', '12345')).resolves.toBe(true);
      expect(redis.del).toHaveBeenCalledWith('otp:u@e.com');
      expect(redis.del).toHaveBeenCalledWith('otp:attempts:u@e.com');
    });

    it('returns false and increments the attempt counter on a wrong code', async () => {
      const stored = service.hash('12345');
      redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(stored);

      await expect(service.verifyOtp('u@e.com', '99999')).resolves.toBe(false);
      expect(redis.incr).toHaveBeenCalledWith('otp:attempts:u@e.com');
    });

    it('locks out (429) after too many invalid attempts', async () => {
      redis.get.mockResolvedValueOnce('5'); // attempts already at the limit
      await expect(service.verifyOtp('u@e.com', '12345')).rejects.toBeInstanceOf(HttpException);
    });

    it('returns false when no code is stored', async () => {
      redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      await expect(service.verifyOtp('u@e.com', '12345')).resolves.toBe(false);
    });
  });
});
