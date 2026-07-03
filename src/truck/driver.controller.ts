import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { Role } from '@src/user/enums/role.enum';
import { AssignmentService } from './assignment.service';

/** Driver-facing truck endpoints (role: COLLECTOR). */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.COLLECTOR)
@Controller({ path: 'driver', version: '1' })
export class DriverController {
  constructor(private readonly assignment: AssignmentService) {}

  /** The truck (and shift) the logged-in driver is assigned to, if any. */
  @Get('my-truck')
  async myTruck(@CurrentUser() user: any) {
    const result = await this.assignment.getMyAssignment(user.id);
    return { message: result.message, result };
  }
}
