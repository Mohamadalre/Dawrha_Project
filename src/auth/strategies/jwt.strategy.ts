import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '@src/user/entities/account.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { UserDevice } from '@src/auth/entities/user-device.entity';
import { RedisService } from '@src/core/redis/redis.service';


@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(UserDevice)
    private readonly deviceRepository: Repository<UserDevice>,
    private readonly redisService: RedisService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: any) {
    const account = await this.accountRepository.findOne({ where: { id: payload.id || payload.sub } });
    if (!account) {
      throw new UnauthorizedException('Account not found');
    }
    // A deleted (archived) account is gone as far as every route is concerned:
    // the row is only kept so its email/phone stay claimed, so a token it still
    // holds must stop working at once — reported as "not found", never as a
    // hint that the account exists.
    if (account.archivedAt) {
      throw new UnauthorizedException('Account not found');
    }

    const key = `blackListToken:${account.id}`;
    const isBlackListed = await this.redisService.getRedisByKey(key);

    if(isBlackListed === payload.jti)
      throw new UnauthorizedException('Token is invalidated, please login again');
    if (account.accountStatus == AccountStatus.INACTIVE || !account.isEmailVerified) {
      throw new UnauthorizedException('Account is disabled or not found');
    }
    // Checked on EVERY request, which is what makes a block take effect at
    // once: the access token already in the app's memory is still
    // cryptographically valid, and this is the only thing standing between it
    // and the API until it expires.
    if (account.accountStatus == AccountStatus.BLOCKED) {
      throw new UnauthorizedException(
        'Your account has been blocked. Please contact technical support.',
      );
    }



    // The EFFECTIVE language is per DEVICE, with the account as the fallback: the
    // token carries the deviceId, so each device this account signed in from can
    // read responses in its own language, and a device that never chose one
    // inherits the account default. Read fresh (not from the token) so a change
    // in settings takes effect on the very next request, no re-login.
    let language = account.language;
    if (payload.deviceId) {
      const device = await this.deviceRepository.findOne({
        where: { accountId: account.id, deviceId: payload.deviceId },
        select: ['id', 'language'],
      });
      if (device?.language) language = device.language;
    }
    return { id: account.id, role: payload.role, email: account.email, accountStatus: account.accountStatus, language, deviceId: payload.deviceId, jti: payload.jti };
  }
}
