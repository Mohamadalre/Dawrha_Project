import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Warehouse } from './entities/warehouse.entity';
import { WarehouseManager } from './entities/warehouse-manager.entity';
import { WarehouseInventory } from './entities/warehouse-inventory.entity';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { OdooService } from '@src/odoo/odoo.service';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { OdooSyncStatus } from '@src/waste-management/enums/odoo-sync-status.enum';
import { buildPagination, PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import { StockStatus } from '@src/waste-management/enums/stock-status.enum';

@Injectable()
export class WarehouseAdminService {
  private readonly logger = new Logger(WarehouseAdminService.name);

  constructor(
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    @InjectRepository(WarehouseManager)
    private readonly managerRepo: Repository<WarehouseManager>,
    @InjectRepository(WarehouseInventory)
    private readonly inventoryRepo: Repository<WarehouseInventory>,
    private readonly odoo: OdooService,
    private readonly odooSync: OdooSyncService,
  ) {}

  /**
   * Creates a warehouse FROM the backend. It is saved locally as PENDING and a
   * background job pushes it to Odoo (recycle.warehouse + zones). If the Odoo
   * creation ultimately fails, the job's compensation removes this row, so a
   * warehouse never lingers in the backend without its Odoo counterpart.
   * The admin assigns a manager later inside Odoo (synced via sync-manager).
   */
  async create(dto: CreateWarehouseDto) {
    const existing = await this.warehouseRepo.findOne({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Warehouse code already exists');

    const warehouse = this.warehouseRepo.create({
      name: dto.name,
      code: dto.code,
      latitude: dto.latitude != null ? String(dto.latitude) : undefined,
      longitude: dto.longitude != null ? String(dto.longitude) : undefined,
      address: dto.address,
      zones: dto.zones?.map((z) => ({ name: z.name, type: z.type })),
      odooSyncStatus: OdooSyncStatus.PENDING,
      isActive: true,
    });
    const saved = await this.warehouseRepo.save(warehouse);

    await this.odooSync.enqueueCreateWarehouse({ warehouseId: saved.id });

    return {
      warehouse_id: saved.id,
      name: saved.name,
      code: saved.code,
      zones: saved.zones ?? [],
      odoo_sync_status: saved.odooSyncStatus,
      status: 'QUEUED',
      message: 'Warehouse created and queued for Odoo sync',
    };
  }

  /**
   * Pulls the manager the admin assigned to this warehouse in Odoo and mirrors
   * it into the backend (warehouse_managers).
   */
  async syncManagerFromOdoo(warehouseId: string) {
    const warehouse = await this.warehouseRepo.findOne({ where: { id: warehouseId } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    if (!warehouse.odooWarehouseId) {
      throw new BadRequestException('Warehouse is not synced to Odoo yet');
    }

    await this.syncManager(warehouse);

    const manager = await this.managerRepo.findOne({
      where: { warehouse: { id: warehouse.id } },
      relations: ['warehouse'],
    });

    return {
      warehouse_id: warehouse.id,
      manager: manager
        ? {
            manager_id: manager.id,
            name: manager.fullName,
            email: manager.email,
            phone: manager.phone,
          }
        : null,
      message: manager ? 'Manager synced from Odoo' : 'No manager assigned in Odoo yet',
    };
  }

  /**
   * Imports warehouses (and their managers) FROM Odoo into the local DB.
   * Warehouses and managers are created/maintained inside Odoo — the backend
   * never creates them; it only mirrors them here so the read APIs work.
   */
  async importFromOdoo() {
    const odooWarehouses = await this.odoo.fetchWarehouses();
    let created = 0;
    let updated = 0;

    for (const ow of odooWarehouses) {
      let warehouse = await this.warehouseRepo.findOne({
        where: { odooWarehouseId: ow.id },
      });

      if (!warehouse) {
        warehouse = this.warehouseRepo.create({
          odooWarehouseId: ow.id,
          name: ow.name,
          code: ow.code ?? String(ow.id),
          isActive: true,
        });
        created++;
      } else {
        warehouse.name = ow.name ?? warehouse.name;
        warehouse.code = ow.code ?? warehouse.code;
        updated++;
      }
      warehouse.lastOdooSync = new Date();
      const saved = await this.warehouseRepo.save(warehouse);

      await this.syncManager(saved);
    }

    this.logger.log(
      `Imported warehouses from Odoo: ${created} created, ${updated} updated`,
    );
    return {
      imported: odooWarehouses.length,
      created,
      updated,
      message: 'Warehouses imported from Odoo',
    };
  }

  /** Mirrors the Odoo-assigned manager (res.users) into warehouse_managers. */
  private async syncManager(warehouse: Warehouse): Promise<void> {
    try {
      const om = await this.odoo.fetchWarehouseManager(warehouse.odooWarehouseId);
      if (!om) return;

      let manager = await this.managerRepo.findOne({
        where: { odooUserId: om.id },
      });
      if (!manager) {
        manager = this.managerRepo.create({ odooUserId: om.id });
      }
      manager.fullName = om.name ?? manager.fullName ?? '';
      manager.email = om.email || om.login || manager.email;
      manager.phone = om.phone || manager.phone || '';
      manager.warehouse = warehouse;
      await this.managerRepo.save(manager);
    } catch (error) {
      this.logger.warn(
        `Failed to sync manager for warehouse ${warehouse.id}`,
        error as Error,
      );
    }
  }

  async list(query: PaginationQueryDto & { status?: string }) {
    const qb = this.warehouseRepo.createQueryBuilder('w').leftJoinAndSelect('w.manager', 'm');
    if (query.status === 'active') qb.andWhere('w.isActive = true');
    if (query.status === 'inactive') qb.andWhere('w.isActive = false');

    qb.skip((query.page - 1) * query.limit).take(query.limit);
    const [rows, total] = await qb.getManyAndCount();

    const warehouses = await Promise.all(
      rows.map(async (w) => {
        const summary = await this.stockSummary(w.id);
        return {
          warehouse_id: w.id,
          odoo_warehouse_id: w.odooWarehouseId,
          name: w.name,
          code: w.code,
          location: {
            latitude: w.latitude ? Number(w.latitude) : null,
            longitude: w.longitude ? Number(w.longitude) : null,
            address: w.address ?? null,
          },
          capacity: w.capacity ?? null,
          current_load: Number(w.currentLoad),
          load_percentage: w.capacity ? +((Number(w.currentLoad) / w.capacity) * 100).toFixed(2) : null,
          manager: w.manager
            ? {
                manager_id: w.manager.id,
                name: w.manager.fullName,
                phone: w.manager.phone,
                email: w.manager.email,
              }
            : null,
          stock_summary: summary,
          status: w.isActive ? 'active' : 'inactive',
          synced_with_odoo: !!w.lastOdooSync,
          last_odoo_sync: w.lastOdooSync ?? null,
        };
      }),
    );

    return { warehouses, pagination: buildPagination(total, query.page, query.limit) };
  }

  async inventory(warehouseId: string) {
    const warehouse = await this.warehouseRepo.findOne({ where: { id: warehouseId } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const rows = await this.inventoryRepo.find({ where: { warehouseId } });

    let criticalCount = 0;
    const inventory = rows.map((r) => {
      const qty = Number(r.quantity);
      const status = this.stockStatus(qty, r.reorderLevel);
      if (status === StockStatus.OUT_OF_STOCK || qty <= r.reorderLevel) criticalCount++;
      return {
        odoo_product_id: r.odooProductId,
        product_name: r.productName,
        quantity: qty,
        reserved_quantity: Number(r.reservedQuantity),
        reorder_level: r.reorderLevel,
        stock_status: status,
        last_sync: r.syncedAt,
      };
    });

    return {
      warehouse_id: warehouse.id,
      warehouse_name: warehouse.name,
      last_sync_from_odoo: warehouse.lastOdooSync ?? null,
      inventory,
      summary: {
        total_items_count: rows.length,
        total_quantity: rows.reduce((s, r) => s + Number(r.quantity), 0),
        critical_stock_count: criticalCount,
      },
    };
  }

  async sync(warehouseId: string, forceFullSync = false) {
    const warehouse = await this.warehouseRepo.findOne({ where: { id: warehouseId } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const jobId = uuidv4();
    await this.odooSync.enqueueSyncWarehouse({ warehouseId, jobId, forceFullSync });

    return {
      warehouse_id: warehouseId,
      sync_job_id: jobId,
      status: 'QUEUED',
      message: 'Warehouse sync started',
    };
  }

  private async stockSummary(warehouseId: string) {
    const rows = await this.inventoryRepo.find({ where: { warehouseId } });
    return {
      total_items: rows.length,
      total_quantity: rows.reduce((s, r) => s + Number(r.quantity), 0),
      last_sync: rows.reduce<Date | null>(
        (latest, r) => (r.syncedAt && (!latest || r.syncedAt > latest) ? r.syncedAt : latest),
        null,
      ),
    };
  }

  private stockStatus(qty: number, reorder: number): StockStatus {
    if (qty <= 0) return StockStatus.OUT_OF_STOCK;
    if (qty <= reorder) return StockStatus.LOW_STOCK;
    return StockStatus.IN_STOCK;
  }
}
