import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { AdminComplaintService } from './providers/admin-complaint.service';
import {
  ComplaintKind,
  ComplaintRoute,
  ComplaintStatus,
} from './enums/complaint-kind.enum';

class ListComplaintsDto {
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  @IsOptional()
  @IsEnum(ComplaintRoute)
  route?: ComplaintRoute;

  @IsOptional()
  @IsEnum(ComplaintKind)
  kind?: ComplaintKind;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

class DecideComplaintDto {
  @IsEnum(ComplaintStatus)
  status: ComplaintStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolution?: string;
}

/**
 * The admin's complaints desk.
 *
 * Buyers file complaints against a delivered part; this is where the platform
 * admin reads them and answers the ones that are theirs to answer — delivery,
 * billing and the uncategorised. Shortage/quality complaints are routed to the
 * warehouse, but still appear here (filter by `route`) so the admin has the
 * whole picture.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/orders/complaints', version: '1' })
export class AdminComplaintController {
  constructor(private readonly complaints: AdminComplaintService) {}

  @Get()
  @Permissions('admin.orders.view')
  async list(@Query() query: ListComplaintsDto) {
    return this.complaints.list(query);
  }

  @Get(':id')
  @Permissions('admin.orders.view')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.complaints.detail(id);
  }

  @Patch(':id')
  @Permissions('admin.orders.manage')
  async decide(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideComplaintDto,
  ) {
    return this.complaints.decide(id, user.id, dto);
  }
}
