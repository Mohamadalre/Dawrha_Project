import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { CollectionPlanService } from '../services/collection-plan.service';
import {
  CreateCollectionPlanDto,
  UpdateCollectionPlanDto,
} from '../dto/collection-plan.dto';

/**
 * Institution plan APIs: one standing plan per institution (the generator
 * turns its schedule into daily ORG_PLAN requests). Materials are fixed at
 * creation; editing replaces the line set.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'collection-plans', version: '1' })
export class CollectionPlanController {
  constructor(private readonly collectionPlanService: CollectionPlanService) {}

  @Post()
  @Roles(Role.INSTITUTIONS)
  @Permissions('collection.plans.manage')
  async create(@CurrentUser() user, @Body() dto: CreateCollectionPlanDto) {
    const result = await this.collectionPlanService.create(user, dto);
    return { message: 'Collection plan created', result };
  }

  @Get()
  @Permissions('collection.plans.view')
  async getOwn(@CurrentUser() user) {
    const result = await this.collectionPlanService.getOwn(user);
    return { message: 'Collection plan fetched successfully', result };
  }

  @Get(':id')
  @Permissions('collection.plans.view')
  async detail(@CurrentUser() user, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.collectionPlanService.detail(user, id);
    return { message: 'Collection plan fetched successfully', result };
  }

  @Patch(':id')
  @Permissions('collection.plans.manage')
  async update(
    @CurrentUser() user,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCollectionPlanDto,
  ) {
    const result = await this.collectionPlanService.update(user, id, dto);
    return { message: 'Collection plan updated', result };
  }
}
