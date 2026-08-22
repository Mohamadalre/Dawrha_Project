import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CoveragePointsService } from '../services/coverage-points.service';
import {
  CreateCoveragePointDto,
  UpdateCoveragePointDto,
} from '../dto/admin-collection.dto';

/**
 * Admin CRUD over the coverage points idle drivers park at. Delete is a soft
 * one: placed drivers keep their rows, the point simply stops receiving.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/coverage-points', version: '1' })
export class CoveragePointsController {
  constructor(private readonly coverage: CoveragePointsService) {}

  @Get()
  @Permissions('collection.coverage.manage')
  async list() {
    const result = await this.coverage.list();
    return { message: 'Coverage points', result };
  }

  @Post()
  @Permissions('collection.coverage.manage')
  async create(@Body() dto: CreateCoveragePointDto) {
    const result = await this.coverage.create(dto);
    return { message: 'Coverage point created', result };
  }

  @Patch(':id')
  @Permissions('collection.coverage.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCoveragePointDto,
  ) {
    const result = await this.coverage.update(id, dto);
    return { message: 'Coverage point updated', result };
  }

  @Delete(':id')
  @Permissions('collection.coverage.manage')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.coverage.remove(id);
    return { message: 'Coverage point removed', result: { id } };
  }
}