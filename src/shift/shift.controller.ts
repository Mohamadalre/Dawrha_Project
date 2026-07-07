import { Body, Controller, Get, Param, Patch, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { ShiftService } from './shift.service';
import { UpdateShiftDto } from './dto/update-shift.dto';

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

  /** Admin-only: edit a shift's name/times (shifts are seeded, not created). */
  @Patch(':id')
  @Permissions('admin.shifts.manage')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateShiftDto) {
    const result = await this.shiftService.updateTimes(id, dto);
    return { message: result.message, result };
  }
}
