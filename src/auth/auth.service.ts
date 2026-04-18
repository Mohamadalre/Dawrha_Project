import { Injectable, UnauthorizedException, BadRequestException, Logger, HttpCode } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { UserService } from '../user/user.service';
import { UserDevice } from './entities/user-device.entity';
import {  RefreshTokenDto, ForgotPasswordDto, ResetPasswordDto } from './dto/auth.dto';
import {RegisterDto} from './dto/register.dto'
import { OtpService } from './otp.service';
import {LoginDto} from './dto/login.dto'
import { Role } from '@src/user/enums/role.enum';
import { Account } from '@src/user/entities/account.entity';
import { UUID } from 'typeorm/driver/mongodb/bson.typings.js';

@Injectable()
export class AuthService {
  //private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(UserDevice)
    private readonly userDeviceRepository: Repository<UserDevice>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly otpService: OtpService,
  ) {}

  async register(registerDto: RegisterDto,role:Role) {
    const existAccount = await this.accountRepository.findOne({where:{email:registerDto.email }});
    if(existAccount)  throw new BadRequestException('The email already exists');
    const hashPassword = await argon2.hash(registerDto.password);
    const account = this.accountRepository.create({
      email:registerDto.email,
      passwordHash:hashPassword,
      role:role,
      phone:registerDto.phone,
    });
    const saveAccount = await this.accountRepository.save(account);
    if(role == Role.CITIZEN) await this.otpService.generateAndSendOtp(saveAccount.email)
    return this.generateTokens(account.id, account.role, registerDto.deviceId, registerDto.deviceType, registerDto.fcmToken);
  }

  async login(loginDto: LoginDto) {
    const account = await this.userService.findByEmail(loginDto.email);
    const isPasswordValid = await argon2.verify(account.passwordHash!, loginDto.password);
    
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!account.isEmailVerified) {
    await this.otpService.generateAndSendOtp(account.email);
    return {message:'Your account is not activated,please enter a otp code'}

    
    }
    await this.userService.update(account.id,{lastLoginAt:Date.now()});
    return this.generateTokens(account.id, account.role, loginDto.deviceId, loginDto.deviceType, loginDto.fcmToken);
  }

  private async generateTokens(accountId: string, role: string, deviceId?: string, deviceType?: string, fcmToken?: string) {
    const payload = { id: accountId, role:role };
    
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
        deviceId,
        deviceType,
        fcmToken,
      });
    } else {
      device.fcmToken = fcmToken || device.fcmToken;
      device.deviceType = deviceType || device.deviceType;
    }
    
    device.refreshToken = hashedRefreshToken;
    device.lastLogin = new Date();
    await this.userDeviceRepository.save(device);

    return {
      accessToken,
      refreshToken: refreshTokenRaw,
    };
  }

  async refreshTokens(refreshDto: RefreshTokenDto) {
    try {
      const payload = await this.jwtService.verifyAsync(refreshDto.refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const device = await this.userDeviceRepository.findOne({ 
        where: { accountId: payload.sub, deviceId: refreshDto.deviceId } 
      });

      if (!device || !device.refreshToken) {
        throw new UnauthorizedException('Access denied');
      }

      const isRefreshTokenValid = await argon2.verify(device.refreshToken, refreshDto.refreshToken);
      if (!isRefreshTokenValid) {
        throw new UnauthorizedException('Access denied');
      }

      const account = await this.userService.findById(payload.sub);
      return this.generateTokens(account.id, account.role, device.deviceId, device.deviceType, device.fcmToken);
    } catch {
      throw new UnauthorizedException('Access denied');
    }
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const account = await this.userService.findByEmail(forgotPasswordDto.email);
    await this.otpService.generateAndSendOtp(account.email);
    return { message: 'OTP sent successfully' };
  }

  async resetPassword(resetDto: ResetPasswordDto) {
    const isValid = await this.otpService.verifyOtp(resetDto.email, resetDto.otp);
    
    if (!isValid) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    const account = await this.userService.findByEmail(resetDto.email);
    account.passwordHash = await argon2.hash(resetDto.newPassword);
    
    // Saving account (requires public accessor for accountRepository or a dedicated update password func in userService)
    await this.userService['accountRepository'].save(account);

    await this.userDeviceRepository.update({ accountId: account.id }, { refreshToken: '' }); // null to empty string or remove type error

    await this.otpService.clearOtp(resetDto.email);

    return { message: 'Password reset successfully' };
  }
}

