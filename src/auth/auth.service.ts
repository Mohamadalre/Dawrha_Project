import { Injectable, UnauthorizedException, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { UserService } from '../user/user.service';
import { UserDevice } from './entities/user-device.entity';
import { DeviceDto, RefreshTokenDto, RefreshTokenTemporaryDto } from './dto/auth.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/forgot-password.dto'
import { RegisterDto } from './dto/register.dto'
import {
  MailService,
  OTP_COOLDOWN_SECONDS,
  OTP_MAX_DAILY_RESENDS,
} from '../core/mail/mail.service';
import { LoginDto } from './dto/login.dto'
import { Role } from '@src/user/enums/role.enum';
import { Account } from '@src/user/entities/account.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { DeviceType } from '@src/user/enums/deviec-type.enum';
import { RedisService } from '@src/core/redis/redis.service';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import Redis from 'ioredis';
import { AuthProvider } from '@src/user/enums/auth-provider.enum';
import { LoginGoogleDto } from './dto/logoin-google.dto';
import { verifyGoogleToken } from './utils/providers/google.provider';
import {
  AccountNotFoundException,
  AppNotAuthorizedException,
  DeviceNotFoundException,
  EmailAlreadyExistsException,
  InvalidCredentialsException,
  InvalidOtpException,
  InvalidResetTicketException,
  InvalidTokenException,
  PasswordMismatchException,
  PhoneAlreadyExistsException,
} from './exceptions/auth.exceptions';
import { LoginHandler } from './handlers/login.handler';
import { ActiveHandler } from './handlers/active.handler';
import { PendingProfileHandler } from './handlers/pending-profile.handler';
import { PendingApprovalHandler } from './handlers/pending-approval.handler';
import { BlockedHandler } from './handlers/blocked.handler';
import { RejectedHandler } from './handlers/rejected.handler';
import { InactiveHandler } from './handlers/inactive.handler';
import { NeedChangeHandler } from './handlers/needChange.handler';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { VerifyResetOtpDto } from './dto/verifyReset-otp.dto';
import { Language } from '@src/common/enums/language.enum';
import { AllowedAccountType } from './utils/constants/AllowedAccountType';





@Injectable()
export class AuthService {

  private handlers: Record<AccountStatus, LoginHandler>;

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    @InjectRepository(UserDevice)
    private readonly userDeviceRepository: Repository<UserDevice>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly mailService: MailService,
    private activeHandler: ActiveHandler,
    private pendingApprovalHandler: PendingApprovalHandler,
    private pendingProfileHandler: PendingProfileHandler,
    private blockedHandler: BlockedHandler,
    private rejectedHandler: RejectedHandler,
    private inactiveHandler: InactiveHandler,
    private needChangeHandler: NeedChangeHandler
  ) {
    this.handlers = {
      [AccountStatus.ACTIVE]: this.activeHandler,
      [AccountStatus.PENDING_PROFILE]: this.pendingProfileHandler,
      [AccountStatus.BLOCKED]: this.blockedHandler,
      [AccountStatus.REJECTED]: this.rejectedHandler,
      [AccountStatus.PENDING_APPROVAL]: this.pendingApprovalHandler,
      [AccountStatus.INACTIVE]: this.inactiveHandler,
      [AccountStatus.NEED_CHANGES]: this.needChangeHandler

    };
  }




  async register({ fullName, email, phoneNumber, password }: RegisterDto, role: Role) {

    const existAccount = await this.accountRepository.findOne({ where: { email: email } });
    if (existAccount && !existAccount.isEmailVerified) {
      await this.mailService.generateAndSendOtp(existAccount.email);
      const token = await this.generateTemporaryTokens(existAccount.id, existAccount.role, existAccount.accountStatus);
      return { message: 'Your account is not confirmed , please make sure that the verification code has reached your email', result: token }
    }
    if (existAccount && existAccount.isEmailVerified) throw new EmailAlreadyExistsException();
    const existPhone = await this.accountRepository.findOne({ where: { phone: phoneNumber } });
    if (existPhone) throw new PhoneAlreadyExistsException();

    const hashPassword = await argon2.hash(password);

    const account = this.accountRepository.create({
      name: fullName,
      email: email,
      phone: phoneNumber,
      passwordHash: hashPassword,
      role: role,
      accountStatus: AccountStatus.INACTIVE,

    });
    const saveAccount = await this.accountRepository.save(account);
    await this.mailService.generateAndSendOtp(saveAccount.email);

    const token = await this.generateTemporaryTokens(saveAccount.id, saveAccount.role, saveAccount.accountStatus);
    return { message: 'An account has been created,please ensure that a verification code has been sent to your email .', result: token }
  }

  /**
   * Authenticate with email and password for a specific role.
   * @param dto contains email, password, deviceId, fcmToken, deviceType
   * @param role expected account role for login
   * @returns handler result that may include access/refresh tokens or temporary token info
   */
  async login({ email, password, deviceId, fcmToken, deviceType, rememberMy }: LoginDto, role: string) {
    const account = await this.accountRepository.findOne({ where: { email: email } });
    const allowed = AllowedAccountType[role];
    if (!account) {
      throw new InvalidCredentialsException();
    }

    if (!allowed || !allowed.includes(account.role)) {
      throw new AppNotAuthorizedException();
    }
    const isPasswordValid = await argon2.verify(account.passwordHash, password);
    if (!isPasswordValid) {
      throw new InvalidCredentialsException();
    }

    const handler = this.handlers[account.accountStatus];
    const details = await handler.handle(account, { deviceId, fcmToken, deviceType, rememberMy });
    return { details: details, role: account.role }
  }

  /**
   * Verify OTP and activate the user account.
   * @param dto contains otpCode, deviceId, deviceType, fcmToken
   * @param userId current user id from temporary authentication
   * @returns full access and refresh tokens when OTP succeeds
   */
  async verifyOtpCode({ otpCode, deviceId, deviceType, fcmToken }: VerifyOtpDto, userId: string, jti: string) {

    let account = await this.userService.findById(userId);
    const existVerify = await this.mailService.verifyOtp(account.email, otpCode)
    if (!existVerify) {
      throw new InvalidOtpException()
    }

    await this.userService.update(userId, {
      isEmailVerified: true,
      accountStatus: account.role == Role.CITIZEN ? AccountStatus.ACTIVE : AccountStatus.PENDING_PROFILE
    })

    const updatedAccount = await this.userService.findById(userId);
    const handler = this.handlers[updatedAccount.accountStatus];
    const details = await handler.handle(updatedAccount, { deviceId, fcmToken, deviceType });
    await this.redisService.setRedisKey({ redisKey: `blackListTokenTemp:${userId}`, redisValue: jti, date: 1200 });
    return { details: details, role: account.role };

  }


  /**
   * Resend OTP email with a short cooldown.
   * @param userId current user id for which to resend OTP
   * @returns cooldownSeconds until the next resend is allowed
   */
  async resendOtpCode(userId: string) {
    const account = await this.userService.findById(userId);
    const cooldownKey = `otp:cooldown:${account.email}`;
    const ttl = await this.redis.ttl(cooldownKey);

    if (ttl > 0) {
      throw new HttpException({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Please wait before requesting again',
        remainingSeconds: ttl
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    // Cap the number of resends per email per day (anti email-bombing).
    const dailyKey = `otp:resend:count:${account.email}`;
    const count = await this.redis.incr(dailyKey);
    if (count === 1) await this.redis.expire(dailyKey, 86400);
    if (count > OTP_MAX_DAILY_RESENDS) {
      throw new HttpException({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Daily resend limit reached. Please try again later.',
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    // generateAndSendOtp owns the cooldown — single source of truth.
    await this.mailService.generateAndSendOtp(account.email);
    return {
      cooldownSeconds: OTP_COOLDOWN_SECONDS
    };
  }


  /**
   * Generate and send a password reset URL for an email.
   * @param dto contains email
   * @returns success message after sending the reset URL
   */
  async forgotPassword({ email }: ForgotPasswordDto) {
    // Uniform behaviour whether or not the account exists — never reveal which
    // emails are registered (anti-enumeration). Same response, same timing.
    const cdKey = `forgotPassword:cooldown:${email}`;
    const ttl = await this.redis.ttl(cdKey);
    if (ttl > 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Please wait before requesting again',
          remainingSeconds: ttl,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Set the cooldown up-front (existent or not) so timing is indistinguishable.
    await this.redis.set(cdKey, 'locked', 'EX', OTP_COOLDOWN_SECONDS);

    const account = await this.accountRepository.findOne({ where: { email } });
    if (account) {
      await this.mailService.generateAndSendOtpForgot(account.email);
    } else {
      winstonLogger.warn(`Forgot-password requested for non-existent email: ${email}`, {
        context: 'ForgotPassword',
        channel: 'app',
        metadata: { task: 'auth' },
      });
    }

    return { message: 'If this email exists, an OTP has been sent.' };
  }

  /**
   * Resends the forgot-password OTP with the same cooldown + daily cap used by
   * the registration resend. Keeps the anti-enumeration behaviour: the response
   * and timing are identical whether or not the email is registered.
   */
  async resendForgotPasswordOtp({ email }: ForgotPasswordDto) {
    const cooldownKey = `forgotPassword:cooldown:${email}`;
    const ttl = await this.redis.ttl(cooldownKey);
    if (ttl > 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Please wait before requesting again',
          remainingSeconds: ttl,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Anti email-bombing: cap resends per email per day.
    const dailyKey = `forgotPassword:resend:count:${email}`;
    const count = await this.redis.incr(dailyKey);
    if (count === 1) await this.redis.expire(dailyKey, 86400);
    if (count > OTP_MAX_DAILY_RESENDS) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Daily resend limit reached. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.redis.set(cooldownKey, 'locked', 'EX', OTP_COOLDOWN_SECONDS);

    const account = await this.accountRepository.findOne({ where: { email } });
    if (account) {
      await this.mailService.generateAndSendOtpForgot(account.email);
    }

    return { cooldownSeconds: OTP_COOLDOWN_SECONDS };
  }

  async verifyResetOtp({ email, otpCode }: VerifyResetOtpDto) {
    const account = await this.userService.findByEmail(email);

    // Validates against the forgot-password OTP key and throws (with attempt
    // lockout) on a wrong/expired code — the reset ticket is issued ONLY when
    // this passes.
    await this.mailService.verifyResetOtp(account.email, otpCode);

    // Single-use, cryptographically-random ticket authorising the actual reset.
    const ticket = randomBytes(32).toString('hex');
    await this.redis.set(`forgotPassword:reset:${email}`, ticket, 'EX', 600);

    return { message: 'Code verified', result: { resetTicket: ticket } };
  }


  async resetPassword({ newPassword, confirmPassword, resetTicket, email }: ResetPasswordDto,) {

    if (newPassword !== confirmPassword) throw new PasswordMismatchException();
    const storedTicket = await this.redis.get(`forgotPassword:reset:${email}`);
    if (!storedTicket || storedTicket !== resetTicket) {
      throw new InvalidResetTicketException();
    } const account = await this.userService.findByEmail(email);
    if (!account) {
      // Should not normally happen if email was valid during step 1/2,
      // but guard anyway.
      throw new InvalidResetTicketException();
    }

    const hashedPassword = await argon2.hash(newPassword);

    await this.userService.update(account.id, { passwordHash: hashedPassword });

    // Invalidate all existing sessions/devices for this account
    await this.userDeviceRepository.update(
      { accountId: account.id },
      { refreshToken: '' },
    );

    // Consume the reset ticket (single-use)
    await this.redis.del(`forgotPassword:reset:${email}`);

    return { message: 'Password reset successfully' };
  }

  /**
   * Logout user by invalidating the refresh token for a specific device.
   * @param userId current authenticated user id
   * @param deviceId device id to logout from
   * @returns success object after clearing saved tokens
   */
  async logout(userId: string, deviceId: string, jti: string) {
    const device = await this.userDeviceRepository.findOne({
      where: { accountId: userId, deviceId: deviceId }
    });
    if (!device) {
      throw new UnauthorizedException('Access denied');
    }


    await this.userDeviceRepository.update(device.id, { fcmToken: '', refreshToken: '' })
    await this.redisService.clearByKey(`refreshToken:${device.deviceId}`)
    await this.redisService.setRedisKey({ redisKey: `blackListToken:${userId}`, redisValue: jti, date: 600 });

    return { success: true };
  }


  /**
   * Generate access and refresh tokens, store hashed refresh token per device.
   * @param accountId id of the authenticated account
   * @param role account role
   * @param accountStatus current account status
   * @param deviceId device identifier for refresh token storage
   * @param deviceType optional device type
   * @param fcmToken optional push notification token
   * @returns accessToken and raw refreshToken
   */
  async generateTokens(accountId: string, role: Role, accountStatus: AccountStatus, deviceId: string, deviceType?: DeviceType, fcmToken?: string, rememberMy: boolean = false) {
    const payload = { id: accountId, role: role, accountStatus, jti: randomBytes(16).toString('base64url') };

    const [accessToken, refreshTokenRaw] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRATION') as any,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: rememberMy ?
          this.configService.get<string>('JWT_REFRESH_REMEMBER_ME_EXPIRATION') as any
          : this.configService.get<string>('JWT_REFRESH_DEFAULT_EXPIRATION') as any,
      }),
    ]);


    const hashedRefreshToken = await argon2.hash(refreshTokenRaw);


    // A (accountId, deviceId) pair is unique (see UserDevice entity). The same
    // physical deviceId may belong to different accounts (e.g. shared device
    // after logout), so we scope the lookup by accountId — never globally.
    let device = await this.userDeviceRepository.findOne({ where: { accountId, deviceId } });
    if (!device) {
      device = this.userDeviceRepository.create({
        accountId,
        deviceType,
        fcmToken,
        deviceId
      });
    } else {
      device.fcmToken = fcmToken || device.fcmToken;
      device.deviceType = deviceType || device.deviceType;

    }


    device.refreshToken = hashedRefreshToken;
    device.lastLogin = new Date();
    await this.userDeviceRepository.save(device);


    await this.redisService.setRedisKey({ redisKey: `refreshToken:${device.deviceId}`, redisValue: hashedRefreshToken, date: 1000 });

    return {
      accessToken,
      refreshToken: refreshTokenRaw,
    };
  }





  /**
   * Refresh a temporary authentication token before OTP confirmation.
   * @param dto contains the temporary token string
   * @returns a new temporary token object if valid
   */
  async refreshTemporaryTokens({ token }: RefreshTokenTemporaryDto) {
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_TEMPORARY_SECRET'),
      });

      const account = await this.userService.findById(payload.sub || payload.id);
      if (account.accountStatus !== AccountStatus.INACTIVE) throw new InvalidTokenException();


      return await this.generateTemporaryTokens(account.id, account.role, account.accountStatus);
    } catch {
      throw new InvalidTokenException();
    }
  }


  /**
   * Generate a temporary token used before OTP confirmation.
   * @param accountId id of the account
   * @param role account role
   * @param accountStatus current account status
   * @returns object containing a temporary token
   */
  async generateTemporaryTokens(accountId: string, role: Role, accountStatus: AccountStatus) {
    const payload = { id: accountId, role: role, accountStatus: accountStatus, jti: randomBytes(16).toString('base64url') };
    const TemporaryToken = await this.jwtService.signAsync(payload,
      {
        secret: this.configService.get<string>('JWT_TEMPORARY_SECRET'),
        expiresIn: this.configService.get<string>('JWT_TEMPORARY_EXPIRATION') as any,
      });

    // Unified key casing (was `Token` — FIXES.md #36): frontend reads data.token.
    return { token: TemporaryToken };
    
  }

  /**
   * Refresh access tokens using a stored hashed refresh token.
   * @param dto contains deviceId
   * @param token raw refresh token string
   * @param accountId current account id
   * @returns new access and refresh tokens if refresh token is valid
   */
  async refreshTokens({ deviceId }: RefreshTokenDto, token: string, accountId: string) {
    try {

      const account = await this.userService.findById(accountId);
      let hashedRefreshToken = await this.redisService.getRedisByKey(`refreshToken:${deviceId}`);

      if (!hashedRefreshToken) {
        const device = await this.userDeviceRepository.findOne({
          where: { accountId: account.id, deviceId: deviceId }
        });

        if (!device || !device.refreshToken) {
          throw new UnauthorizedException('Access denied, invalid token');
        }

        // Source of truth is the DB; repopulate the cache from it (do NOT reuse
        // setRedisKey's void return — that was silently breaking refresh).
        hashedRefreshToken = device.refreshToken;
        await this.redisService.setRedisKey({ redisKey: `refreshToken:${device.deviceId}`, redisValue: device.refreshToken, date: 1000 });
      }

      const isRefreshTokenValid = await argon2.verify(hashedRefreshToken, token);
      if (!isRefreshTokenValid) {
        throw new UnauthorizedException('Access denied');
      }
      return this.generateTokens(account.id, account.role, account.accountStatus, deviceId);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      throw new UnauthorizedException("access denied, invalid token")
    }
  }



  /**
   * Authenticate or register a Google user for the requested role.
   * @param dto contains Tokenid, deviceId, deviceType, fcmToken
   * @param role expected account role for Google login
   * @returns accessToken, refreshToken, accountStatus, role
   */
  async loginWithGoogle({ TokenId, deviceId, deviceType, fcmToken, rememberMy }: LoginGoogleDto, role: string) {
    const { email, googleId } = await verifyGoogleToken(TokenId);
    const allowed = AllowedAccountType[role];

    const account = await this.accountRepository.findOne({
      where: { email: email },
    });


    if (!account) {
      throw new AccountNotFoundException('Account not found. Please register first.');
    }

    if (!allowed || !allowed.includes(account.role)) {
      throw new AppNotAuthorizedException();

    }

    if (!account.googleId) {
      account.googleId = googleId;
      account.provider = AuthProvider.GOOGLE;
      await this.accountRepository.save(account);
    }

    const handler = this.handlers[account.accountStatus];
    const details = await handler.handle(account, { deviceId, fcmToken, deviceType, rememberMy });

    return { details, role: account.role };

  }


  async registerWithGoogle({ TokenId, deviceId, deviceType, fcmToken }: LoginGoogleDto, role: Role) {
    const { name, email, googleId, picture } = await verifyGoogleToken(TokenId);


    const existing = await this.accountRepository.findOne({
      where: { email: email },
    });

    if (existing) {
      throw new EmailAlreadyExistsException('The email already exists. Please login instead.');
    }


    const accountCreated = this.accountRepository.create({
      name: name,
      email: email,
      role,
      isEmailVerified: true,
      provider: AuthProvider.GOOGLE,
      googleId: googleId,
      profileImage: picture,
      accountStatus:
        role === Role.CITIZEN || role === Role.ADMIN ? AccountStatus.ACTIVE : AccountStatus.PENDING_PROFILE
    });

    await this.accountRepository.save(accountCreated);


    const handler = this.handlers[accountCreated.accountStatus];
    const details = await handler.handle(accountCreated, { deviceId, fcmToken, deviceType });
    return { details: details, role: accountCreated.role }

  }


  async addFCMToken({ deviceId, deviceType, fcmToken }: DeviceDto, userId: string) {

    const account = await this.accountRepository.findOne({
      where: { id: userId },
    });


    if (!account) {
      throw new AccountNotFoundException();
    }
    const device = await this.userDeviceRepository.findOne({ where: { accountId: userId, deviceId } });
    if (!device) {
      throw new DeviceNotFoundException();
    }
    await this.userDeviceRepository.update({ accountId: userId, deviceId }, { fcmToken, deviceType });


    return { message: 'FCM token updated successfully.' }

  }

  /**
   * Updates the notification language of one of the caller's devices. Push
   * notifications to that device are then localized to the chosen language.
   */
  async updateDeviceLanguage(userId: string, deviceId: string, language: Language) {
    const device = await this.userDeviceRepository.findOne({
      where: { accountId: userId, deviceId },
    });
    if (!device) {
      throw new DeviceNotFoundException();
    }

    await this.userDeviceRepository.update({ accountId: userId, deviceId }, { language });
    return { message: 'Device language updated successfully', language };
  }




}