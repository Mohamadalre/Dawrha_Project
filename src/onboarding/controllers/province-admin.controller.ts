import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Get,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import {
  CreateProvinceDto,
  ListProvincesDto,
  UpdateProvinceDto,
} from '../dto/province.dto';
import { ProvinceAdminService } from '../services/province-admin.service';

/**
 * Governorates management — ADMIN ONLY.
 *
 * Reading the list stays public-ish on `GET /onboarding/provinces` (every
 * signup form needs it); only mutations live here behind the ADMIN role.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller({ path: 'admin/provinces', version: '1' })
export class ProvinceAdminController {
  constructor(private readonly provinceAdmin: ProvinceAdminService) {}

  /**
   * The governorates, a page at a time.
   *
   * Separate from the public `GET /onboarding/provinces`, which returns every
   * row unpaged because a signup dropdown that arrives half-filled cannot be
   * used. This list is browsed and searched rather than picked from.
   */
  @Get()
  async list(@Query() query: ListProvincesDto) {
    const result = await this.provinceAdmin.list(query);
    return { message: 'Provinces fetched successfully', ...result };
  }

  @Post()
  async create(@Body() dto: CreateProvinceDto) {
    const result = await this.provinceAdmin.create(dto);
    return { message: 'Governorate created successfully', result };
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProvinceDto,
  ) {
    const result = await this.provinceAdmin.update(id, dto);
    return { message: 'Governorate updated successfully', result };
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.provinceAdmin.remove(id);
    return { message: 'Governorate deleted successfully', result };
  }
}
