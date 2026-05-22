import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';

import WarehouseService
from './warehouse.service';

import { CreateWarehouseDto }
from './dto/create-warehouse.dto';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@src/auth/guards/roles.guard';
import { Roles } from '@src/auth/decorators/roles.decorator';
import { Role } from '@src/user/enums/role.enum';


@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller({
  path: 'warehouse',
  version: '1',
})
export class WarehouseController {
  constructor(
    private readonly warehouseService:
      WarehouseService,
  ) {}

  @Post()
  async create(
    @Body()
    dto: CreateWarehouseDto,
  ) {
    return this.warehouseService.create(dto);
  }
}