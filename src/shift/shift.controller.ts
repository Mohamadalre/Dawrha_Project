import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { ShiftService } from './shift.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'shifts', version: '1' })
export class ShiftController {
  constructor(private readonly shiftService: ShiftService) {}

  /** List shifts — available to drivers (for onboarding) and admins. */
  @Get()
  async list() {
    const result = await this.shiftService.list();
    return { message: 'Shifts fetched successfully', result };
  }

}
