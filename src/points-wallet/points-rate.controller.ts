import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { Role } from '@src/user/enums/role.enum';
import { PointsRateService } from './points-rate.service';

class CreatePointsRateDto {
  @IsEnum(Role)
  role: Role;

  /** The money one point is worth, e.g. 1000 → 1 point per 1000 SYP. */
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  amount_per_point: number;

  // No currency here: it is the central platform setting
  // (PATCH /v1/admin/platform-settings), never chosen per rate.
}

class UpdatePointsRateDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  amount_per_point?: number;
}

/**
 * The admin sets how much one POINT is worth, per role — the conversion used to
 * reward a completed order (an order worth `amount_per_point × N` earns N
 * points on receipt).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller({ path: 'admin/points-rate', version: '1' })
export class PointsRateController {
  constructor(private readonly service: PointsRateService) {}

  /** All rates, one per role. */
  @Get()
  async list() {
    const result = await this.service.list();
    return { message: 'Points rates fetched successfully', result };
  }

  /** Add (or replace) the rate for a role. */
  @Post()
  async create(@CurrentUser() admin: any, @Body() dto: CreatePointsRateDto) {
    return this.service.create(dto.role, dto.amount_per_point, admin.id);
  }

  /** Edit the rate for a role in place. */
  @Patch(':role')
  async update(
    @CurrentUser() admin: any,
    @Param('role') role: Role,
    @Body() dto: UpdatePointsRateDto,
  ) {
    return this.service.update(
      role,
      { amountPerPoint: dto.amount_per_point },
      admin.id,
    );
  }
}
