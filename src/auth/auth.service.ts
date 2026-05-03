import { Injectable, UnauthorizedException, BadRequestException, Inject, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { UserService } from '../user/user.service';
import { UserDevice } from './entities/user-device.entity';
import { DeviceDto, RefreshTokenDto, RefreshTokenTemporayDto } from './dto/auth.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/forgot-password.dto'
import { RegisterDto } from './dto/register.dto'
import { MailService } from '../core/mail/mail.service';
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
import { verifyGoogleToken } from './google.provider';
import { LoginHandler } from './handlers/login.handler';
import { ActiveHandler } from './handlers/active.handler';
import { PendingProfileHandler } from './handlers/pending-profile.handler';
import { PendingApprovalHandler } from './handlers/pending-approval.handler';
import { BlockedHandler } from './handlers/blocked.handler';
import { RejectedHandler } from './handlers/rejected.handler';
import { InactiveHandler } from './handlers/inactive.handler';
import { NeedChangeHandler } from './handlers/needChange.handler';




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
    if (existAccount) throw new BadRequestException('The email already exists');
    const existphone = await this.accountRepository.findOne({ where: { phone: phoneNumber } });
    if (existphone) throw new BadRequestException('The phone already exists');

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

    return await this.generateTokensTemporary(saveAccount.id, saveAccount.role, saveAccount.accountStatus);
  }

  async login({ email, password, deviceId, fcmToken, deviceType }: LoginDto, role: Role) {
    const account = await this.accountRepository.findOne({ where: { email: email } });
    if (!account) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (account.role !== role) {
      throw new UnauthorizedException(`You cannot enter as ${role},your account is registered as ${account.role}`)
    }
    const isPasswordValid = await argon2.verify(account.passwordHash!, password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!account.isEmailVerified) {
      await this.mailService.generateAndSendOtp(account.email);
      const token = await this.generateTokensTemporary(account.id, account.role, account.accountStatus);
      return { status: 'The email is not confirmed ', data: token }
    }
    const handler = this.handlers[account.accountStatus];
    return handler.handle(account, { deviceId, fcmToken, deviceType })
  }

  async verifyOtpServ({ otpCode, deviceId, deviceType, fcmToken }: VerifyOtpDto, userId: string) {

    const account = await this.userService.findById(userId);
    const existVerify = await this.mailService.verifyOtp(account.email, otpCode)
    if (!existVerify) {
      throw new BadRequestException('The verification code is incorrect or expired')
    }
    await this.userService.update(userId, { isEmailVerified: true, accountStatus: account.role == Role.CITIZEN ? AccountStatus.ACTIVE : AccountStatus.PENDING_PROFILE })
    const { accessToken, refreshToken } = await this.generateTokens(account.id, account.role, account.accountStatus, deviceId, deviceType, fcmToken);
    return { accessToken, refreshToken };
  }


  async resendOtpServ(userId: string) {
    const account = await this.userService.findById(userId);
    const cooldownKey = `otp:cooldown:${account.email}`;
    const ttl = await this.redis.ttl(cooldownKey);
    console.log(ttl);

    if (ttl > 0) {

      throw new HttpException({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Please wait before requesting again',
        remainingSeconds: ttl
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    await this.mailService.generateAndSendOtp(account.email);
    await this.redis.set(cooldownKey, 'locked', 'EX', 120);
    return {
      cooldownSeconds: 120
    };
  }


  async forgotPassword({ email }: ForgotPasswordDto) {
    const account = await this.userService.findByEmail(email);
    await this.mailService.generateAndSendTokenUrl(account.email, account.id);
    return { message: 'TokenURL sent successfully' };
  }



  async resetPassword({ newPassword, confirmPassword, tokenUrl }: ResetPasswordDto,) {

    if (newPassword !== confirmPassword) throw new BadRequestException('Passwords do not match');
    const userId = await this.mailService.getRedisByKey(`reset:${tokenUrl}`);
    if (!userId) throw new BadRequestException('Invailed or expired token');
    const hashPassword = await argon2.hash(newPassword);
    const existUser = await this.userService.update(userId!, { passwordHash: hashPassword })


    await this.userDeviceRepository.update({ accountId: userId }, { refreshToken: '' }); // null to empty string or remove type error

    await this.mailService.clearByKey(`reset:${tokenUrl}`);



    return { message: 'Password reset successfully' };
  }

  async logoutServ(userId: string, deviceId: string) {
    const device = await this.userDeviceRepository.findOne({
      where: { accountId: userId, deviceId: deviceId }
    });
    if (!device) {
      throw new UnauthorizedException('Access denied');
    }


    await this.userDeviceRepository.update(device.id, { fcmToken: '', refreshToken: '' })
    await this.redisService.clearByKey(`refreshToken:${device.deviceId}`)

    return { success: true };
  }


  async generateTokens(accountId: string, role: Role, accountStatus: AccountStatus, deviceId: string, deviceType?: DeviceType, fcmToken?: string) {
    const payload = { id: accountId, role: role, accountStatus };

    const [accessToken, refreshTokenRaw] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
        expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRATION') as any,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
        expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION') as any,
      }),
    ]);


    const hashedRefreshToken = await argon2.hash(refreshTokenRaw);


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





  async refreshTokensTemporary({ token }: RefreshTokenTemporayDto) {
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_TEMPORARY_SECRET'),
      });

      const account = await this.userService.findById(payload.sub || payload.id);
      if (account.accountStatus !== AccountStatus.INACTIVE) throw new UnauthorizedException('Invaild Token')


      return await this.generateTokensTemporary(account.id, account.role, account.accountStatus);
    } catch {
      throw new UnauthorizedException('Invaild Token');
    }
  }


  async generateTokensTemporary(accountId: string, role: Role, accountStatus: AccountStatus) {
    const payload = { id: accountId, role: role, accountStatus };
    const TemporaryToken = await this.jwtService.signAsync(payload,
      {
        secret: this.configService.get<string>('JWT_TEMPORARY_SECRET')!,
        expiresIn: this.configService.get<string>('JWT_TEMPORARY_EXPIRATION') as any,
      });

    return { Token: TemporaryToken };
  }

  async refreshTokens({ deviceId }: RefreshTokenDto, token: string,accountId:string) {
    try {

      const account = await this.userService.findById(accountId);
      let existRedis: any;
      existRedis = await this.redisService.getRedisByKey(`refreshToken:${deviceId}`);

      if (!existRedis) {
        const device = await this.userDeviceRepository.findOne({
          where: { accountId: account.id, deviceId: deviceId }
        });


        if (!device || !device.refreshToken) {
          throw new UnauthorizedException('Access denied, invalid token');
        }
        existRedis = await this.redisService.setRedisKey({ redisKey: `refreshToken:${device.deviceId}`, redisValue: device.refreshToken, date: 1000 });
      }


      const isRefreshTokenValid = await argon2.verify(existRedis, token);
      if (!isRefreshTokenValid) {
        throw new UnauthorizedException('Access denied');
      }
      return this.generateTokens(account.id, account.role, account.accountStatus, deviceId);
    } catch (error) {
      throw new UnauthorizedException("access denied, invalid token")
    }
  }



  async googleLogin({ Tokenid, deviceId, deviceType, fcmToken }: LoginGoogleDto, role: Role) {
    const { email, name, googleId, picture } = await verifyGoogleToken(Tokenid);

    let account = await this.accountRepository.findOne({
      where: { email: email },
    });

    if (account) {
      if (account.role !== role) {
        throw new UnauthorizedException(`You cannot enter as ${role},your account is registered as ${account.role}`)
      }
      if (!account.googleId) {
        account.googleId = googleId;
        account.provider = AuthProvider.GOOGLE;
        await this.accountRepository.save(account);
      }
    }
    else {
      account = this.accountRepository.create({
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

      await this.accountRepository.save(account);
    }


    const tokens = await this.generateTokens(account.id, account.role, account.accountStatus, deviceId, deviceType, fcmToken)

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accountStatus: account.accountStatus,
      role: account.role,
    };
  }




}


