import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { Role } from '@src/user/enums/role.enum';
import { PointsWalletService, isWalletEligible } from './points-wallet.service';

/** Paging for the leaderboard — a fixed number of ranked users per page. */
class LeaderboardQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

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

  /**
   * The points leaderboard — user (citizen) accounts ranked by points, highest
   * first, paginated, each with its current stage name.
   *
   * USER accounts only: the caller must be a CITIZEN (and ACTIVE, which the
   * global status guard already enforces). Any other role — institution,
   * factory, free facility, driver, admin — is refused, because the leaderboard
   * is the users' own standing. The caller's own rank is returned in `me`.
   */
  @Get('leaderboard')
  async leaderboard(@CurrentUser() user, @Query() query: LeaderboardQueryDto) {
    if (user.role !== Role.CITIZEN) {
      throw new ForbiddenException('The leaderboard is available to user accounts only');
    }
    const result = await this.wallet.leaderboard(query.page, query.limit, user.id);
    return { message: 'Leaderboard fetched successfully', result };
  }
}
