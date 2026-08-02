import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { Role } from '@src/user/enums/role.enum';
import { AssignmentService } from './assignment.service';
import { HandoverService } from './handover.service';

class DropoffDto {
  /** Mandatory note about the truck's condition before handing it back. */
  @IsString()
  @MaxLength(1000)
  reason: string;
}

class PickupDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** Driver-facing truck endpoints (role: COLLECTOR). */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.COLLECTOR)
@Controller({ path: 'driver', version: '1' })
export class DriverController {
  constructor(
    private readonly assignment: AssignmentService,
    private readonly handover: HandoverService,
  ) {}

  /** The truck (and shift + warehouse) the logged-in driver is assigned to. */
  @Get('my-truck')
  async myTruck(@CurrentUser() user: any) {
    return this.assignment.getMyAssignment(user.id);
  }

  /** Current handover state (holding a truck? which one? his assigned truck). */
  @Get('handover-status')
  async handoverStatus(@CurrentUser() user: any) {
    return this.handover.status(user.id);
  }

  /** "Pick up truck" — records the pickup time (guarded by the shift window). */
  @Post('pickup')
  async pickup(@CurrentUser() user: any, @Body() _dto: PickupDto) {
    return this.handover.pickup(user.id);
  }

  /** "Hand over truck" — records the dropoff time + a mandatory truck note. */
  // 200: this CLOSES the handover the pickup opened — it updates that row
  // rather than creating one, so 201 would be wrong.
  @HttpCode(HttpStatus.OK)
  @Post('dropoff')
  async dropoff(@CurrentUser() user: any, @Body() dto: DropoffDto) {
    return this.handover.dropoff(user.id, dto.reason);
  }
}
