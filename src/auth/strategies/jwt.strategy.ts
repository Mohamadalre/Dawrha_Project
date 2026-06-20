import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '@src/user/entities/account.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { RedisService } from '@src/core/redis/redis.service';


@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
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

    const key = `blackListToken:${account.id}`;
    const isBlackListed = await this.redisService.getRedisByKey(key);
    if(isBlackListed) 
      throw new UnauthorizedException('Token is invalidated, please login again');
    if (!account || account.accountStatus == AccountStatus.INACTIVE || !account.isEmailVerified) {
      throw new UnauthorizedException('Account is disabled or not found');
    }
    if (account.accountStatus == AccountStatus.BLOCKED) {
      throw new UnauthorizedException('Account is blocked ');
    }


    return { id: account.id, role: payload.role, email: account.email, accountStatus: account.accountStatus ,jti:payload.jti};
  }
}
