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
import {
  WarehouseCodeExistsException,
  WarehouseNotFoundException,
  WarehouseNotSyncedException,
} from './exceptions/warehouse.exceptions';
import { WarehouseManager } from './entities/warehouse-manager.entity';
import { WarehouseInventory } from './entities/warehouse-inventory.entity';
import { TruckEntity } from '@src/truck/entities/truck.entity';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { OdooService } from '@src/odoo/odoo.service';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { OdooSyncStatus } from '@src/waste-management/enums/odoo-sync-status.enum';
import { buildPagination, PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import { StockStatus } from '@src/waste-management/enums/stock-status.enum';
import { ConditionsService } from '@src/waste-management/common/providers/conditions.service';

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
    @InjectRepository(TruckEntity)
    private readonly truckRepo: Repository<TruckEntity>,
    private readonly odoo: OdooService,
    private readonly odooSync: OdooSyncService,
    private readonly conditionsService: ConditionsService,
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
    if (existing) throw new WarehouseCodeExistsException();

    const warehouse = this.warehouseRepo.create({
      name: dto.name,
      code: dto.code,
      latitude: dto.latitude != null ? String(dto.latitude) : undefined,
      longitude: dto.longitude != null ? String(dto.longitude) : undefined,
      address: dto.address,
      governorate: dto.governorate,
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
    if (!warehouse) throw new WarehouseNotFoundException();
    if (!warehouse.odooWarehouseId) {
      throw new WarehouseNotSyncedException();
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

    // Single aggregate query for all warehouses on the page (no N+1).
    const summaries = await this.stockSummaries(rows.map((w) => w.id));
    const truckCounts = await this.truckCounts(rows.map((w) => w.id));

    const warehouses = rows.map((w) => {
        const summary =
          summaries.get(w.id) ?? { total_items: 0, total_quantity: 0, last_sync: null };
        return {
          warehouse_id: w.id,
          odoo_warehouse_id: w.odooWarehouseId,
          name: w.name,
          code: w.code,
          location: {
            latitude: w.latitude ? Number(w.latitude) : null,
            longitude: w.longitude ? Number(w.longitude) : null,
            address: w.address ?? null,
            governorate: w.governorate ?? null,
          },
          capacity: w.capacity ?? null,
          current_load: Number(w.currentLoad),
          truck_count: truckCounts.get(w.id) ?? 0,
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
      });

    return { warehouses, pagination: buildPagination(total, query.page, query.limit) };
  }

  async inventory(warehouseId: string) {
    const warehouse = await this.warehouseRepo.findOne({ where: { id: warehouseId } });
    if (!warehouse) throw new WarehouseNotFoundException();

    const rows = await this.inventoryRepo.find({ where: { warehouseId } });
    const conditionLabels = await this.conditionsService.labelMap();

    // Rows are mirrored per (product, condition) — group them so the admin sees
    // each material once with its grade breakdown (الحالة + كميتها).
    interface ProductEntry {
      odoo_product_id?: number;
      product_name?: string;
      quantity: number;
      reserved_quantity: number;
      reorder_level: number;
      last_sync?: Date;
      conditions: Record<string, unknown>[];
    }
    const byProduct = new Map<string, ProductEntry>();
    for (const r of rows) {
      const key = String(r.odooProductId);
      let entry = byProduct.get(key);
      if (!entry) {
        entry = {
          odoo_product_id: r.odooProductId,
          product_name: r.productName,
          quantity: 0,
          reserved_quantity: 0,
          reorder_level: r.reorderLevel,
          last_sync: r.syncedAt,
          conditions: [],
        };
        byProduct.set(key, entry);
      }
      const qty = Number(r.quantity);
      const reserved = Number(r.reservedQuantity);
      entry.quantity += qty;
      entry.reserved_quantity += reserved;
      entry.reorder_level = Math.max(entry.reorder_level, r.reorderLevel);
      if (r.syncedAt && (!entry.last_sync || r.syncedAt > entry.last_sync)) entry.last_sync = r.syncedAt;
      entry.conditions.push({
        condition: r.conditionCode,
        condition_label: conditionLabels.get(r.conditionCode) ?? r.conditionCode,
        quantity: qty,
        reserved_quantity: reserved,
        available: Math.max(qty - reserved, 0),
      });
    }

    let criticalCount = 0;
    const inventory = [...byProduct.values()].map((entry) => {
      const status = this.stockStatus(entry.quantity, entry.reorder_level);
      if (status === StockStatus.OUT_OF_STOCK || entry.quantity <= entry.reorder_level) criticalCount++;
      return { ...entry, stock_status: status };
    });

    return {
      warehouse_id: warehouse.id,
      warehouse_name: warehouse.name,
      last_sync_from_odoo: warehouse.lastOdooSync ?? null,
      inventory,
      summary: {
        total_items_count: inventory.length,
        total_quantity: rows.reduce((s, r) => s + Number(r.quantity), 0),
        critical_stock_count: criticalCount,
      },
    };
  }

  async sync(warehouseId: string, forceFullSync = false) {
    const warehouse = await this.warehouseRepo.findOne({ where: { id: warehouseId } });
    if (!warehouse) throw new WarehouseNotFoundException();

    const jobId = uuidv4();
    await this.odooSync.enqueueSyncWarehouse({ warehouseId, jobId, forceFullSync });

    return {
      warehouse_id: warehouseId,
      sync_job_id: jobId,
      status: 'QUEUED',
      message: 'Warehouse sync started',
    };
  }

  /** Trucks per warehouse in ONE query (fleet is authored in Odoo, mirrored here). */
  private async truckCounts(warehouseIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (warehouseIds.length === 0) return map;
    const rows = await this.truckRepo
      .createQueryBuilder('t')
      .select('t.warehouseId', 'warehouseId')
      .addSelect('COUNT(*)', 'count')
      .where('t.warehouseId IN (:...ids)', { ids: warehouseIds })
      .groupBy('t.warehouseId')
      .getRawMany();
    for (const r of rows) map.set(r.warehouseId, Number(r.count));
    return map;
  }

  /** Aggregated stock summary for many warehouses in ONE query (avoids N+1). */
  private async stockSummaries(
    warehouseIds: string[],
  ): Promise<Map<string, { total_items: number; total_quantity: number; last_sync: Date | null }>> {
    const map = new Map<string, { total_items: number; total_quantity: number; last_sync: Date | null }>();
    if (warehouseIds.length === 0) return map;

    const rows = await this.inventoryRepo
      .createQueryBuilder('i')
      .select('i.warehouseId', 'warehouseId')
      .addSelect('COUNT(*)', 'items')
      .addSelect('COALESCE(SUM(i.quantity), 0)', 'quantity')
      .addSelect('MAX(i.syncedAt)', 'lastSync')
      .where('i.warehouseId IN (:...ids)', { ids: warehouseIds })
      .groupBy('i.warehouseId')
      .getRawMany();

    for (const r of rows) {
      map.set(r.warehouseId, {
        total_items: Number(r.items),
        total_quantity: Number(r.quantity),
        last_sync: r.lastSync ?? null,
      });
    }
    return map;
  }

  private stockStatus(qty: number, reorder: number): StockStatus {
    if (qty <= 0) return StockStatus.OUT_OF_STOCK;
    if (qty <= reorder) return StockStatus.LOW_STOCK;
    return StockStatus.IN_STOCK;
  }
}
