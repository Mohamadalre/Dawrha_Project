import { Controller, Get, UseGuards, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { WasteManagementService } from './waste-management.service';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { AccountStatus } from '@src/user/enums/account-status.enum';

/**
 * Onboarding-facing waste categories.
 *
 * Category CREATE / UPDATE / DELETE live on the admin catalogue controller
 * (POST/PUT/DELETE /admin/waste/categories). This controller only serves the
 * read the onboarding steps need.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller({
  path: 'waste-management',
  version: '1'
})
export class WasteManagementController {
  constructor(private readonly wasteManagementService: WasteManagementService) { }

  /**
   * Active waste categories (id + name), for the onboarding pickers.
   *
   * Reachable while still onboarding: a factory / free facility / institution
   * picks the categories it deals in DURING profile completion (PENDING_PROFILE)
   * or while its request is pending (PENDING_APPROVAL), not only once ACTIVE.
   */
  @AccountsStatus(
    AccountStatus.ACTIVE,
    AccountStatus.PENDING_PROFILE,
    AccountStatus.PENDING_APPROVAL,
  )
  @Roles(Role.ADMIN, Role.EXTERNAL_PARTNER, Role.FACTORY, Role.INSTITUTIONS)
  @Get('onboarding/waste-categories')
  async findAll(@Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) {
    const result = await this.wasteManagementService.findAllName(page);
    return { message: 'Fetch waste categories successfully', result };
  }
}
