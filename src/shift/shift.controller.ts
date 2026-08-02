import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { AccountStatusGuard } from '@src/auth/guards/account-status.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { AccountsStatus } from '@src/auth/decorators/account-status.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { ShiftService } from './shift.service';

/**
 * Driver-facing shift pickers. Two separate routes on purpose, because the
 * audience differs by onboarding stage:
 *
 *   GET /shifts/onboarding — auth/onboarding stage. The account is still
 *     PENDING_PROFILE (no warehouse yet) → GLOBAL driver shifts ONLY. The id it
 *     returns is used in POST /onboarding/collector/information.
 *
 *   GET /shifts/available — after acceptance (ACTIVE, belongs to a warehouse) →
 *     GLOBAL driver shifts PLUS the ones scoped to HIS OWN warehouse, MINUS his
 *     current shift. The id it returns is used in POST /shift-change-requests.
 *
 * Both are COLLECTOR-only and inherently owner-scoped (they resolve the driver
 * from the JWT, never a path/query id).
 */
@UseGuards(JwtAuthGuard, AccountStatusGuard, RolesGuard)
@Controller({ path: 'shifts', version: '1' })
export class ShiftController {
  constructor(private readonly shiftService: ShiftService) {}

  /** Onboarding stage: global driver shifts only (account PENDING_PROFILE). */
  @Get('onboarding')
  @Roles(Role.COLLECTOR)
  @AccountsStatus(AccountStatus.PENDING_PROFILE)
  async onboardingShifts() {
    const result = await this.shiftService.listOnboardingShifts();
    return { message: 'Shifts fetched successfully', result };
  }

  /**
   * Shift-change picker: global + own-warehouse driver shifts, minus the
   * driver's current shift (account ACTIVE). Feeds POST /shift-change-requests.
   */
  @Get('available')
  @Roles(Role.COLLECTOR)
  @AccountsStatus(AccountStatus.ACTIVE)
  async availableShifts(@CurrentUser() user: any) {
    const result = await this.shiftService.listAvailableShifts(user.id);
    return { message: 'Shifts fetched successfully', result };
  }
}
