import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '@src/user/entities/account.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';


@Injectable()
export class JwtTemporaryStrategy extends PassportStrategy(Strategy,'jwtTemporary') {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_TEMPORARY_SECRET'),
    });
  }

  async validate(payload: any) {
    const account = await this.accountRepository.findOne({where:{id:payload.id || payload.sub}});
    
    if (!account || account.accountStatus !== AccountStatus.INACTIVE) {
      throw new UnauthorizedException('Account is disabled or not found');
    }
  
  
    return { id: account.id, role: payload.role,email:account.email };
  }
}
