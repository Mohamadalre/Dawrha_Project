import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { AccountManagementService } from './account-management.service';

/**
 * Self-service reads for a FACTORY, INSTITUTION, free facility or DRIVER about
 * its OWN account, once ACTIVE.
 *
 * These mirror the admin review routes (`account-details` / `location` /
 * documents) exactly — same builders, same shape — but resolve the profile
 * from the caller's token instead of taking a profile id, and are gated to
 * ACTIVE accounts: the caller is looking at their own finished application, not
 * one still under review. The role check (the four self-service roles) lives in
 * the service, next to the resolution it guards.
 */
@UseGuards(JwtAuthGuard)
@Controller({ path: 'account', version: '1' })
export class SelfAccountController {
  constructor(private readonly service: AccountManagementService) {}

  /** The caller's own account details — same shape as the admin review view. */
  @Get('details')
  @AccountsStatus(AccountStatus.ACTIVE)
  async details(@CurrentUser() user) {
    const result = await this.service.getOwnAccountDetails(user.id, user.role);
    return { message: 'Account details fetched successfully', result };
  }

  /** The caller's own location. */
  @Get('location')
  @AccountsStatus(AccountStatus.ACTIVE)
  async location(@CurrentUser() user) {
    const result = await this.service.getOwnLocation(user.id, user.role);
    return { message: 'Location fetched successfully', result };
  }

  /** The caller's own uploaded documents / images. */
  @Get('images')
  @AccountsStatus(AccountStatus.ACTIVE)
  async images(@CurrentUser() user) {
    const result = await this.service.getOwnDocuments(user.id, user.role);
    return { message: 'Documents fetched successfully', result };
  }
}
