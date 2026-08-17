import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Warehouse } from './entities/warehouse.entity';
import { WarehouseState } from './enums/warehouse-state.enum';
import {
  WarehouseCodeExistsException,
  WarehouseNameExistsException,
  WarehouseNotFoundException,
  WarehouseNotSyncedException,
  WarehouseProvinceNotFoundException,
} from './exceptions/warehouse.exceptions';
import { WarehouseManager } from './entities/warehouse-manager.entity';
import { WarehouseInventory } from './entities/warehouse-inventory.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { TruckEntity } from '@src/truck/entities/truck.entity';
import { OrderPart } from '@src/order/entities/order-part.entity';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { OdooService } from '@src/odoo/odoo.service';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { OdooSyncStatus } from '@src/waste-management/enums/odoo-sync-status.enum';
import { buildPagination, PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import { StockStatus } from '@src/waste-management/enums/stock-status.enum';
import { ConditionsService } from '@src/waste-management/common/providers/conditions.service';
import { Province } from '@src/user/entities/location/province.entity';
import { MeasurementUnit } from '@src/waste-management/entities/measurement-unit.entity';

/** A warehouse's stock, counted per unit — kilograms and pieces do not add up. */
export interface WarehouseStockSummary {
  total_items: number;
  totals_by_unit: {
    unit_id: string | null;
    unit_code: string;
    total_quantity: number;
    total_reserved: number;
    total_available: number;
  }[];
  last_sync: Date | null;
}

/** Matches Odoo's three-decimal quantities — floats otherwise show 0.30000000004. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

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
    // Orders are counted from the PARTS: a split order is one order to the
    // buyer and one job to each warehouse in it.
    @InjectRepository(OrderPart)
    private readonly orderPartRepo: Repository<OrderPart>,
    private readonly odoo: OdooService,
    private readonly odooSync: OdooSyncService,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly conditionsService: ConditionsService,
    // The governorate is resolved to a real row before a warehouse is saved —
    // a typed name cannot be checked against anything.
    @InjectRepository(Province)
    private readonly provinceRepo: Repository<Province>,
  ) {}

  /**
   * Creates a warehouse FROM the backend. It is saved locally as PENDING and a
   * background job pushes it to Odoo (recycle.warehouse + zones). If the Odoo
   * creation ultimately fails, the job's compensation removes this row, so a
   * warehouse never lingers in the backend without its Odoo counterpart.
   * The admin assigns a manager later inside Odoo (synced via sync-manager).
   */
  /**
   * Is this code already a warehouse's, ignoring case and padding?
   *
   * Case-INSENSITIVE, matching the unique index. The old check compared the
   * code exactly, so "wh1" sailed past a database already holding "WH1" and
   * failed at the insert instead — and to everyone who writes a code on
   * paperwork or reads one over the phone, those are the same warehouse.
   */
  private async codeTaken(code: string, exceptId?: string): Promise<boolean> {
    const qb = this.warehouseRepo
      .createQueryBuilder('w')
      .where('upper(btrim(w.code)) = upper(btrim(:code))', { code });
    if (exceptId) qb.andWhere('w.id != :exceptId', { exceptId });
    return (await qb.getCount()) > 0;
  }

  /**
   * Is this NAME already in use?
   *
   * Case- and padding-insensitive, exactly as the code check is and for the
   * same reason: to everyone who reads a name off paperwork or hears it over
   * the phone, "Damascus Main" and "damascus main " are one warehouse, and a
   * rule that disagrees with its users is one they walk past by accident.
   *
   * Matches Odoo's own `_check_name_unique`, so a name refused on one side is
   * refused on the other — two systems disagreeing about what is allowed is how
   * a create succeeds locally and then fails forever in the sync queue.
   */
  private async nameTaken(name: string, exceptId?: string): Promise<boolean> {
    const qb = this.warehouseRepo
      .createQueryBuilder('w')
      .where('upper(btrim(w.name)) = upper(btrim(:name))', { name });
    if (exceptId) qb.andWhere('w.id != :exceptId', { exceptId });
    return (await qb.getCount()) > 0;
  }

  async create(dto: CreateWarehouseDto) {
    if (await this.codeTaken(dto.code)) throw new WarehouseCodeExistsException();
    if (await this.nameTaken(dto.name)) throw new WarehouseNameExistsException();

    // The governorate is REQUIRED and resolved to a real row before anything is
    // saved. Order allocation matches buyers to warehouses by this id, so a
    // warehouse without one holds stock that no order can ever be routed to —
    // and the failure surfaces later as "no warehouse can fulfil this", which
    // points nowhere near here.
    const province = await this.provinceRepo.findOne({
      where: { id: dto.provinceId },
    });
    if (!province) throw new WarehouseProvinceNotFoundException();

    const warehouse = this.warehouseRepo.create({
      name: dto.name.trim(),
      // Stored trimmed: a trailing space makes two codes that print alike and
      // compare differently, and the one nobody can see is the one that breaks.
      code: dto.code.trim(),
      latitude: dto.latitude != null ? String(dto.latitude) : undefined,
      longitude: dto.longitude != null ? String(dto.longitude) : undefined,
      address: dto.address,
      provinceId: province.id,
      // The NAME is a mirror of the row above, kept because listings, reports
      // and the Odoo payload all read it. Written from the resolved province
      // and never from free text, so the two cannot disagree. Arabic is the
      // stored label — it is what Odoo's province mirror displays and what the
      // paperwork carries; the English name is one join away when needed.
      governorate: province.name_ar || province.name_en,
      zones: dto.zones?.map((z) => ({ name: z.name, type: z.type })),
      odooSyncStatus: OdooSyncStatus.PENDING,
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

  async list(query: PaginationQueryDto & { status?: string; search?: string }) {
    const qb = this.warehouseRepo.createQueryBuilder('w').leftJoinAndSelect('w.manager', 'm');
    // Filtered on the lifecycle `state` now that `isActive` is gone: "active"
    // means operational (not permanently stopped), "inactive" means closed.
    if (query.status === 'active') {
      qb.andWhere('w.state != :whInactive', { whInactive: WarehouseState.INACTIVE });
    }
    if (query.status === 'inactive') {
      qb.andWhere('w.state = :whInactive', { whInactive: WarehouseState.INACTIVE });
    }

    // CLOSED warehouses are NOT filtered out by default, and that is the point.
    // A warehouse that has stopped taking new work still holds stock, still has
    // open orders shipping out of it, and is still the answer to "where is my
    // material". Hiding it from the listing hides the very rows an admin needs
    // while a site winds down. `status` is there for whoever wants one side.

    if (query.search?.trim()) {
      // Partial and case-insensitive, over the NAME and the CODE.
      //
      // Both, because an admin arrives at a warehouse from either direction:
      // they half-remember what it is called, or they are holding paperwork
      // that carries only the code. One search box that answers both is one
      // fewer decision before typing.
      //
      // Matching whole words would mean already knowing the answer to the
      // question being asked.
      qb.andWhere('(w.name ILIKE :search OR w.code ILIKE :search)', {
        search: `%${query.search.trim()}%`,
      });
    }

    // Newest first. The warehouse an admin is looking for is almost always the
    // one just created — alphabetical order buries it at whatever letter it
    // happens to start with.
    qb.orderBy('w.createdAt', 'DESC').addOrderBy('w.id', 'DESC');

    qb.skip((query.page - 1) * query.limit).take(query.limit);
    const [rows, total] = await qb.getManyAndCount();

    // Single aggregate query for all warehouses on the page (no N+1).
    const summaries = await this.stockSummaries(rows.map((w) => w.id));
    const truckCounts = await this.truckCounts(rows.map((w) => w.id));
    const orderCounts = await this.orderCounts(rows.map((w) => w.id));

    const warehouses = rows.map((w) => {
        const summary =
          summaries.get(w.id) ?? { total_items: 0, totals_by_unit: [], last_sync: null };
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
          // Fleet at this warehouse, split by type (mirrored from Odoo).
          trucks: truckCounts.get(w.id) ?? { collection: 0, delivery: 0, total: 0 },
          truck_count: (truckCounts.get(w.id)?.total) ?? 0,
          // Mirrored from Odoo — shipments only exist there.
          shipment_count: w.shipmentCount ?? 0,
          // Counted here — orders are placed on this side.
          order_count: orderCounts.get(w.id) ?? 0,
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
          status: w.state === WarehouseState.INACTIVE ? 'inactive' : 'active',
          synced_with_odoo: !!w.lastOdooSync,
          last_odoo_sync: w.lastOdooSync ?? null,
        };
      });

    return { warehouses, pagination: buildPagination(total, query.page, query.limit) };
  }

  /**
   * ONE warehouse, in exactly the same shape the listing returns — so a client
   * can reuse the same rendering code for a row and for its detail screen.
   */
  async detail(warehouseId: string) {
    const w = await this.warehouseRepo.findOne({
      where: { id: warehouseId },
      relations: ['manager'],
    });
    if (!w) throw new WarehouseNotFoundException();

    const summaries = await this.stockSummaries([w.id]);
    const truckCounts = await this.truckCounts([w.id]);
    const orderCounts = await this.orderCounts([w.id]);
    const summary = summaries.get(w.id) ?? {
      total_items: 0, totals_by_unit: [], last_sync: null,
    };

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
      trucks: truckCounts.get(w.id) ?? { collection: 0, delivery: 0, total: 0 },
      truck_count: (truckCounts.get(w.id)?.total) ?? 0,
      shipment_count: w.shipmentCount ?? 0,
      order_count: orderCounts.get(w.id) ?? 0,
      load_percentage: w.capacity
        ? +((Number(w.currentLoad) / w.capacity) * 100).toFixed(2)
        : null,
      manager: w.manager
        ? {
            manager_id: w.manager.id,
            name: w.manager.fullName,
            phone: w.manager.phone,
            email: w.manager.email,
          }
        : null,
      stock_summary: summary,
      status: w.state === WarehouseState.INACTIVE ? 'inactive' : 'active',
      synced_with_odoo: !!w.lastOdooSync,
      last_odoo_sync: w.lastOdooSync ?? null,
    };
  }

  /**
   * Edit a warehouse's own details.
   *
   * Deliberately NOT editable here: `odooWarehouseId`, the manager link and
   * the stock figures. Odoo owns the manager assignment (its dashboard has the
   * change-manager action) and the load figures come from the inventory sync —
   * letting an admin type over them would silently desync the two systems.
   */
  async update(warehouseId: string, dto: UpdateWarehouseDto) {
    const w = await this.warehouseRepo.findOne({ where: { id: warehouseId } });
    if (!w) throw new WarehouseNotFoundException();

    // Only what this side owns. Location, governorate and the lifecycle are
    // edited in Odoo — it is the operational system — and flow back through
    // SYNC_WAREHOUSE. Accepting them here too would let the two overwrite each
    // other with whichever wrote last, which is how the pair silently drifts.
    if (dto.name !== undefined) {
      // Checked for the same reason the code is: the name is what every human
      // uses — it is on the paperwork, on the shipment screen, in the order the
      // driver is handed. Two warehouses sharing one is a load delivered to the
      // wrong building by somebody who read the right name.
      if (await this.nameTaken(dto.name, warehouseId)) {
        throw new WarehouseNameExistsException();
      }
      w.name = dto.name.trim();
    }
    if (dto.code !== undefined) {
      // Checked here, not only caught at the insert: a refusal that names the
      // rule is something the admin can act on, and the database error was
      // being translated into a message that did not say which field.
      if (await this.codeTaken(dto.code, warehouseId)) {
        throw new WarehouseCodeExistsException();
      }
      w.code = dto.code.trim();
    }
    if (dto.capacity !== undefined) w.capacity = dto.capacity;

    // Mark it unsynced BEFORE saving, in the same write.
    //
    // Without this an edit whose push was lost left no trace at all: the row
    // still said SYNCED from its creation, so the reconcile pass — which looks
    // for exactly that column — saw nothing to do, and Odoo kept the old name
    // for ever. The push handler stamps it back to SYNCED when it lands.
    w.odooSyncStatus = OdooSyncStatus.PENDING;

    try {
      await this.warehouseRepo.save(w);
    } catch (err: any) {
      // `code` is unique — return a clean 409 rather than a driver 500.
      if (err?.code === '23505') {
        throw new ConflictException('A warehouse with this code already exists');
      }
      throw err;
    }
    // The edit has to reach Odoo, or the two drift: an admin renaming a
    // warehouse here saw the new name while every Odoo screen, order and report
    // kept the old one. Queued, so a brief Odoo outage cannot fail the save.
    try {
      await this.odooSync.enqueueUpdateWarehouse({ warehouseId });
    } catch {
      // A queue hiccup — the admin's edit still stands locally.
    }
    return this.detail(warehouseId);
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

  /**
   * Trucks per warehouse, split by TYPE. Collection and delivery are two fleets
   * doing two jobs, so a warehouse's fleet is only meaningful when the count
   * says of which kind.
   *
   * The two counts come from two places on purpose: COLLECTION trucks are
   * mirrored in the backend and counted from the local table; DELIVERY trucks
   * are Odoo's alone — never stored here — so their per-warehouse counts are
   * read LIVE from Odoo (one batched call) and merged in by warehouse.
   */
  private async truckCounts(
    warehouseIds: string[],
  ): Promise<Map<string, { collection: number; delivery: number; total: number }>> {
    const map = new Map<string, { collection: number; delivery: number; total: number }>();
    if (warehouseIds.length === 0) return map;

    // Collection fleet — from the mirror.
    const rows = await this.truckRepo
      .createQueryBuilder('t')
      .select('t.warehouseId', 'warehouseId')
      .addSelect('COUNT(*)', 'count')
      .where('t.warehouseId IN (:...ids)', { ids: warehouseIds })
      .groupBy('t.warehouseId')
      .getRawMany();
    for (const r of rows) {
      const entry = map.get(r.warehouseId) ?? { collection: 0, delivery: 0, total: 0 };
      const n = Number(r.count);
      entry.collection += n;
      entry.total += n;
      map.set(r.warehouseId, entry);
    }

    // Delivery fleet — live from Odoo, mapped from Odoo warehouse ids to ours.
    try {
      const deliveryByOdoo = await this.odoo.deliveryTruckCountsByWarehouse();
      if (deliveryByOdoo.length) {
        const listed = await this.warehouseRepo.find({
          where: { id: In(warehouseIds) },
          select: ['id', 'odooWarehouseId'],
        });
        const backendByOdoo = new Map<number, string>();
        for (const w of listed) {
          if (w.odooWarehouseId != null) backendByOdoo.set(w.odooWarehouseId, w.id);
        }
        for (const d of deliveryByOdoo) {
          const backendId = backendByOdoo.get(d.odooWarehouseId);
          if (!backendId) continue;
          const entry = map.get(backendId) ?? { collection: 0, delivery: 0, total: 0 };
          entry.delivery += d.count;
          entry.total += d.count;
          map.set(backendId, entry);
        }
      }
    } catch (err) {
      // Odoo unreachable: report the collection fleet from the mirror, and leave
      // delivery at 0 rather than failing the whole warehouse listing.
      this.logger.warn(
        `Could not read delivery truck counts from Odoo: ${(err as Error).message}`,
      );
    }

    return map;
  }

  /**
   * How many buyer orders each warehouse has been given a share of.
   *
   * Counted HERE rather than mirrored from Odoo, which is the opposite choice
   * to the shipment count beside it, and deliberately so. Orders are placed on
   * this side: a buyer checks out here, allocation splits the basket into parts
   * and each part names a warehouse. Odoo only ever sees the parts that were
   * successfully pushed to it — so its number is this number minus whatever is
   * still queued or failed, which would read as a warehouse quietly having
   * fewer orders than it does.
   *
   * `order_parts`, not `orders`: a split order is one order to the buyer and one
   * job to EACH warehouse in it, and this figure answers "how much work has this
   * site been given".
   *
   * One grouped query for the whole page, like the others here — a count per row
   * would be an N+1 on the busiest admin screen.
   */
  private async orderCounts(warehouseIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (warehouseIds.length === 0) return map;
    const rows = await this.orderPartRepo
      .createQueryBuilder('p')
      .select('p.warehouseId', 'warehouseId')
      .addSelect('COUNT(*)', 'count')
      .where('p.warehouseId IN (:...ids)', { ids: warehouseIds })
      .groupBy('p.warehouseId')
      .getRawMany();
    for (const r of rows) map.set(r.warehouseId, Number(r.count));
    return map;
  }

  /** Aggregated stock summary for many warehouses in ONE query (avoids N+1). */
  /**
   * Per-warehouse stock figures, TOTALLED PER UNIT.
   *
   * There used to be one `total_quantity`, and it was arithmetic on things that
   * cannot be added: 400 kg of scrap paper plus 30 car batteries came back as
   * "430". That number is not merely imprecise, it is meaningless — it changes
   * when a material is re-measured in tonnes without a single kilogram moving,
   * and there is no unit anyone could write beside it. An admin reading it was
   * reading a quantity of nothing.
   *
   * So the answer is one row per unit. Counts of THINGS stay addable and remain
   * a single number; quantities do not and never were.
   *
   * One query for every warehouse on the page, grouped by (warehouse, unit) in
   * the database — an admin opening a list of twenty should not pay for twenty
   * round trips, and the alternative was N+1.
   */
  private async stockSummaries(
    warehouseIds: string[],
  ): Promise<Map<string, WarehouseStockSummary>> {
    const map = new Map<string, WarehouseStockSummary>();
    if (warehouseIds.length === 0) return map;

    const rows = await this.inventoryRepo
      .createQueryBuilder('i')
      // The unit lives on the MATERIAL, and the mirror rows carry only Odoo's
      // product id — so the join is the only way to know what is being counted.
      .leftJoin(Product, 'p', 'p.odoo_product_id = i.odooProductId')
      .leftJoin(MeasurementUnit, 'u', 'u.id = p.unit_id OR u.code = p.unit_type')
      .select('i.warehouseId', 'warehouseId')
      .addSelect('u.id', 'unitId')
      .addSelect('COALESCE(u.code, p.unit_type)', 'unitCode')
      .addSelect('COUNT(DISTINCT i.odooProductId)', 'materials')
      .addSelect('COALESCE(SUM(i.quantity), 0)', 'quantity')
      .addSelect('COALESCE(SUM(i.reservedQuantity), 0)', 'reserved')
      .addSelect('MAX(i.syncedAt)', 'lastSync')
      .where('i.warehouseId IN (:...ids)', { ids: warehouseIds })
      .groupBy('i.warehouseId')
      .addGroupBy('u.id')
      .addGroupBy('u.code')
      .addGroupBy('p.unit_type')
      .getRawMany();

    for (const r of rows) {
      let entry = map.get(r.warehouseId);
      if (!entry) {
        entry = { total_items: 0, totals_by_unit: [], last_sync: null };
        map.set(r.warehouseId, entry);
      }
      const quantity = Number(r.quantity);
      const reserved = Number(r.reserved);
      entry.total_items += Number(r.materials);
      entry.totals_by_unit.push({
        unit_id: r.unitId ?? null,
        // A material whose unit link is dangling still holds real stock; it is
        // bucketed under its raw code rather than dropped, because hiding it
        // would understate the warehouse.
        unit_code: r.unitCode ?? 'UNKNOWN',
        total_quantity: round3(quantity),
        total_reserved: round3(reserved),
        total_available: round3(Math.max(quantity - reserved, 0)),
      });
      if (r.lastSync && (!entry.last_sync || r.lastSync > entry.last_sync)) {
        entry.last_sync = r.lastSync;
      }
    }

    for (const entry of map.values()) {
      entry.totals_by_unit.sort((a, b) => a.unit_code.localeCompare(b.unit_code));
    }
    return map;
  }

  private stockStatus(qty: number, reorder: number): StockStatus {
    if (qty <= 0) return StockStatus.OUT_OF_STOCK;
    if (qty <= reorder) return StockStatus.LOW_STOCK;
    return StockStatus.IN_STOCK;
  }
}
