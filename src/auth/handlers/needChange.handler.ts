import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { LoginHandler } from './login.handler';
import { AuthService } from '../auth.service';
import { Account } from '@src/user/entities/account.entity';
import { DeviceDto } from '../dto/auth.dto';

/**
 * NEED_CHANGES signs in and RECEIVES TOKENS — but they open almost nothing.
 *
 * The account is not active, so `AccountStatusGuard` refuses every route that
 * does not name this status explicitly. What the token is for is the handful
 * that do: seeing the application that is being decided, and answering what was
 * asked. Withholding the token instead left the applicant unable to look at
 * their own file, or to replace a document they were told to replace.
 *
 * The status is NOT carried in the token — `AccountStatusGuard` reads it fresh
 * from the DB each request (keyed by the token's account id), so once the
 * applicant fixes what was asked and is moved on, the new status takes effect
 * immediately, without waiting for this token to expire.
 */
@Injectable()
export class NeedChangeHandler implements LoginHandler {
  constructor(
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  async handle(account: Account, dto: DeviceDto) {
    const token = await this.authService.generateTokens(
      account.id,
      account.role,
      dto.deviceId,
      dto.deviceType,
      dto.fcmToken,
      dto.rememberMy,
    );
    return {
      status: 'NEED_CHANGES',
      token,
    };
  }
}
