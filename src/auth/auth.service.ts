import { Injectable, UnauthorizedException, BadRequestException, Logger, HttpCode } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { UserService } from '../user/user.service';
import { UserDevice } from './entities/user-device.entity';
import { RefreshTokenDto } from './dto/auth.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/forgot-password.dto'
import { RegisterDto } from './dto/register.dto'
import { MailService } from '../core/mail/mail.service';
import { LoginDto } from './dto/login.dto'
import { Role } from '@src/user/enums/role.enum';
import { Account } from '@src/user/entities/account.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { DeviceType } from '@src/user/enums/deviec-type.enum';




@Injectable()
export class AuthService {


  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(UserDevice)
    private readonly userDeviceRepository: Repository<UserDevice>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,

    private readonly mailService: MailService,
  ) { }

  async register({
    fullName,
    email,
    phone,
    password,
    deviceId,
    deviceType,
    fcmToken
  }: RegisterDto, role: Role) {

    const existAccount = await this.accountRepository.findOne({ where: { email: email } });
    if (existAccount) throw new BadRequestException('The email already exists');
    const existphone = await this.accountRepository.findOne({ where: { phone: phone } });
    if (existphone) throw new BadRequestException('The phone already exists');

    const hashPassword = await argon2.hash(password);

    const account = this.accountRepository.create({
      name: fullName,
      email: email,
      phone: phone,
      passwordHash: hashPassword,
      role: role,
      accountStatus: role != Role.CITIZEN ? AccountStatus.PENDING_PROFILE : AccountStatus.INACTIVE,

    });
    const saveAccount = await this.accountRepository.save(account);

    if (role == Role.CITIZEN) {

      await this.mailService.generateAndSendOtp(saveAccount.email);

    }
    return await this.generateTokens(account.id, account.role, account.accountStatus,deviceId,deviceType, fcmToken);
  }

  // async login(loginDto: LoginDto) {
  //   const account = await this.userService.findByEmail(loginDto.email);
  //   const isPasswordValid = await argon2.verify(account.passwordHash!, loginDto.password);

  //   if (!isPasswordValid) {
  //     throw new UnauthorizedException('Invalid credentials');
  //   }
  //   if (!account.isEmailVerified) { 
  //     await this.mailService.generateAndSendOtp(account.email);
  //const data = await this.generateTokens(account.id, account.role, loginDto.deviceType, loginDto.fcmToken);
  //     return { message: 'Your account is not activated,please enter a otp code',data:data }


  //   }

  //   return await this.generateTokens(account.id, account.role, loginDto.deviceType, loginDto.fcmToken);
  // }

  private async generateTokens(accountId: string, role: Role, accountStatus: AccountStatus, deviceId?: string, deviceType?: DeviceType, fcmToken?: string) {
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

    return {
      accessToken,
      refreshToken: refreshTokenRaw,
    };
  }

  // async refreshTokens(refreshDto: RefreshTokenDto) {
  //   try {
  //     const payload = await this.jwtService.verifyAsync(refreshDto.refreshToken, {
  //       secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
  //     });

  //     const device = await this.userDeviceRepository.findOne({
  //       where: { accountId: payload.sub, deviceId: refreshDto.deviceId }
  //     });

  //     if (!device || !device.refreshToken) {
  //       throw new UnauthorizedException('Access denied');
  //     }

  //     const isRefreshTokenValid = await argon2.verify(device.refreshToken, refreshDto.refreshToken);
  //     if (!isRefreshTokenValid) {
  //       throw new UnauthorizedException('Access denied');
  //     }

  //     const account = await this.userService.findById(payload.sub);
  //     return this.generateTokens(account.id, account.role, device.deviceId, device.deviceType, device.fcmToken);
  //   } catch {
  //     throw new UnauthorizedException('Access denied');
  //   }
  // }

  async forgotPassword({email}: ForgotPasswordDto) {
    const account = await this.userService.findByEmail(email);
    await this.mailService.generateAndSendTokenUrl(account.email, account.id);
    return { message: 'TokenURL sent successfully' };
  }



  async resetPassword({ newPassword, confirmPassword,tokenUrl }: ResetPasswordDto, ) {

    if (newPassword !== confirmPassword) throw new BadRequestException('Passwords do not match');
    const userId = await this.mailService.getRedisByKey(`reset:${tokenUrl}`);
    if(!userId) throw new BadRequestException('Invailed or expired token');
    const hashPassword = await argon2.hash(newPassword);
    const existUser = await this.userService.update(userId!,{passwordHash:newPassword})


    await this.userDeviceRepository.update({ accountId:userId}, { refreshToken: '' }); // null to empty string or remove type error

    await this.mailService.clearByKey(`reset:${tokenUrl}`);

    return { message: 'Password reset successfully' };
  }



}

