import {
  Injectable,
  InternalServerErrorException,
  ConflictException,
  Logger
} from '@nestjs/common';

import {
  InjectRepository,
} from '@nestjs/typeorm';

import {
  DataSource,
  Repository,
} from 'typeorm';

import { OdooService }
from '../odoo/odoo.service';

import { Warehouse }
from './entities/warehouse.entity';

import { WarehouseManager }
from './entities/warehouse-manager.entity';

import { CreateWarehouseDto }
from './dto/create-warehouse.dto';

@Injectable()
export default class WarehouseService {
  constructor(
    @InjectRepository(
      Warehouse,
    )
    private readonly warehouseRepository:
      Repository<Warehouse>,

    @InjectRepository(
      WarehouseManager,
    )
    private readonly managerRepository:
      Repository<WarehouseManager>,

    private readonly dataSource:
      DataSource,

    private readonly odooService:
      OdooService,
    

  ) {}
private readonly logger = new Logger(WarehouseService.name);
async create(dto: CreateWarehouseDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let odooWarehouseId: number | null = null;
    let odooManagerId: number | null = null;

    try {
      // 1) إنشاء/الحصول على المستودع في Odoo
      odooWarehouseId = await this.odooService.createWarehouse(
        dto.warehouseName,
        dto.warehouseCode,
      );

      // تحقق إضافي: لا يجب أن يكون null أبداً إذا نجح OdooService
      if (!odooWarehouseId) {
        throw new InternalServerErrorException(
          'Odoo did not return warehouse id',
        );
      }

      // 2) إنشاء المدير في Odoo
      odooManagerId = await this.odooService.createManager({
        fullName: dto.managerFullName,
        email: dto.managerEmail,
        password: dto.managerPassword,
        warehouseId: odooWarehouseId
      });

      if (!odooManagerId) {
        throw new InternalServerErrorException(
          'Odoo did not return manager id',
        );
      }

      // 3) حفظ المستودع محلياً
      const warehouse = queryRunner.manager.create(Warehouse, {
        name: dto.warehouseName,
        code: dto.warehouseCode,
        odooWarehouseId,
      });
      const savedWarehouse = await queryRunner.manager.save(Warehouse, warehouse);

      // 4) حفظ المدير محلياً
      const manager = queryRunner.manager.create(WarehouseManager, {
        fullName: dto.managerFullName,
        email: dto.managerEmail,
        phone: dto.managerPhone,
        odooUserId: odooManagerId,
        warehouse: savedWarehouse,
      });
      const savedManager = await queryRunner.manager.save(
        WarehouseManager,
        manager,
      );

      // 5) ربط العلاقة
      savedWarehouse.manager = savedManager;
      await queryRunner.manager.save(Warehouse, savedWarehouse);

      // 6) تأكيد
      await queryRunner.commitTransaction();

      return {
        message: 'Warehouse created successfully',
        warehouse: savedWarehouse,
        manager: savedManager,
      };
    } catch (error:any) {
      this.logger.error('Warehouse creation failed', error);

      // Rollback قاعدة البيانات المحلية أولاً
      await queryRunner.rollbackTransaction();

      // تنظيف Odoo: حذف ما تم إنشاؤه بنجاح
      // نحذف المدير أولاً (لأنه قد يكون مرتبط بصلاحيات)
      if (odooManagerId) {
        try {
          await this.odooService.deleteUser(odooManagerId);
        } catch (cleanupErr) {
          this.logger.warn('Failed to cleanup Odoo manager', cleanupErr);
        }
      }

      if (odooWarehouseId) {
        try {
          await this.odooService.deleteWarehouse(odooWarehouseId);
        } catch (cleanupErr) {
          this.logger.warn('Failed to cleanup Odoo warehouse', cleanupErr);
        }
      }

      // إعادة رمي الخطأ المناسب للعميل
      if (error instanceof ConflictException) {
        throw error; // مثل: اسم المستودع موجود
      }

      throw new InternalServerErrorException(
        error.message || 'Failed to create warehouse',
      );
    } finally {
      await queryRunner.release();
    }
  }
}