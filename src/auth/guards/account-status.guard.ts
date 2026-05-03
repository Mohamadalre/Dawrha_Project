import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { ACCOUNTSTATUS_KEY } from '../decorators/account-status.decorator';

@Injectable()
export class AccountStatusGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredAccountStatus = this.reflector.getAllAndOverride<AccountStatus[]>(
      ACCOUNTSTATUS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredAccountStatus) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    return requiredAccountStatus.includes(user?.accountStatus);
  }
}