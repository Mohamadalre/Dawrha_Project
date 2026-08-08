import {
  Controller,
  ForbiddenException,
  Get,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { PointsWalletService, isWalletEligible } from './points-wallet.service';

/**
 * The caller's own points wallet.
 *
 * ACTIVE-only by default (the global AccountStatusGuard admits no other status
 * without an explicit decorator), which lines up with the rule that a wallet
 * exists only once the account is active. An admin or a collector reaching this
 * is refused rather than shown an empty wallet — they have none by design.
 */
@UseGuards(JwtAuthGuard)
@Controller({ path: 'wallet', version: '1' })
export class PointsWalletController {
  constructor(private readonly wallet: PointsWalletService) {}

  @Get()
  async myWallet(@CurrentUser() user) {
    if (!isWalletEligible(user.role)) {
      throw new ForbiddenException('This account type does not have a points wallet');
    }
    const result = await this.wallet.view(user.id, user.role);
    return { message: 'Wallet fetched successfully', result };
  }
}
