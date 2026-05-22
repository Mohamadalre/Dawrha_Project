import { Module } from '@nestjs/common';

import { TypeOrmModule }
from '@nestjs/typeorm';

import { Warehouse }
from './entities/warehouse.entity';

import { WarehouseManager }
from './entities/warehouse-manager.entity';

import WarehouseService
from './warehouse.service';

import { WarehouseController }
from './warehouse.controller';

import { OdooModule }
from '../odoo/odoo.module';

@Module({
  imports: [

    TypeOrmModule.forFeature([
      Warehouse,
      WarehouseManager,
    ]),

    OdooModule,
  ],

  providers: [
    WarehouseService,
  ],

  controllers: [
    WarehouseController,
  ],
})

export class WarehouseModule {}