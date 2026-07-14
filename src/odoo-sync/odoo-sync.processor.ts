import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { OdooService } from '@src/odoo/odoo.service';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { ProductPricing } from '@src/waste-management/entities/product-pricing.entity';
import { MeasurementUnit } from '@src/waste-management/entities/measurement-unit.entity';
import {
  MaterialCondition,
  UNGRADED_CONDITION,
} from '@src/waste-management/entities/material-condition.entity';
import { OdooSyncStatus } from '@src/waste-management/enums/odoo-sync-status.enum';
import { PricingTier } from '@src/waste-management/enums/pricing-tier.enum';
import { Account } from '@src/user/entities/account.entity';
import { Role } from '@src/user/enums/role.enum';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { TruckEntity } from '@src/truck/entities/truck.entity';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { ShiftChangeRequest } from '@src/truck/entities/shift-change-request.entity';
import { ShiftChangeRequestStatus } from '@src/truck/enums/shift-change-request-status.enum';
import { TruckStatus } from '@src/truck/enums/truck-status.enum';
import { Shift } from '@src/shift/entities/shift.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import {
  CreateWarehousePayload,
  DeleteCategoryPayload,
  DeleteProductPayload,
  DeleteConditionPayload,
  DeleteUnitPayload,
  DriverDecisionPayload,
  PushDriverRequestPayload,
  PushShiftChangePayload,
  ShiftChangeDecisionPayload,
  ODOO_JOBS,
  ODOO_SYNC_QUEUE,
  SyncCategoryPayload,
  SyncConditionPayload,
  SyncProductPayload,
  SyncUnitPayload,
  SyncWarehousePayload,
  UpdatePricingPayload,
} from './odoo-sync.constants';

/** Unified logging context/channel for all Odoo-sync worker output. */
const LOG_META = { context: 'OdooSyncProcessor', channel: 'jobs' } as const;

@Processor(ODOO_SYNC_QUEUE)
export class OdooSyncProcessor extends WorkerHost {
  constructor(
    private readonly odoo: OdooService,
    private readonly notifications: NotificationService,
    @InjectRepository(WasteCategory)
    private readonly categoryRepo: Repository<WasteCategory>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductPricing)
    private readonly pricingRepo: Repository<ProductPricing>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    @InjectRepository(WarehouseInventory)
    private readonly inventoryRepo: Repository<WarehouseInventory>,
    @InjectRepository(MeasurementUnit)
    private readonly unitRepo: Repository<MeasurementUnit>,
    @InjectRepository(MaterialCondition)
    private readonly conditionRepo: Repository<MaterialCondition>,
    @InjectRepository(TruckEntity)
    private readonly truckRepo: Repository<TruckEntity>,
    @InjectRepository(TruckAssignmentEntity)
    private readonly assignmentRepo: Repository<TruckAssignmentEntity>,
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,
    @InjectRepository(CollectorProfile)
    private readonly collectorRepo: Repository<CollectorProfile>,
    @InjectRepository(ShiftChangeRequest)
    private readonly shiftChangeRepo: Repository<ShiftChangeRequest>,
  ) {
    super();
  }

  /** Job-name → handler dispatch map (same pattern as MailProcessor). */
  private readonly handlers: Record<string, (job: Job) => Promise<unknown>> = {
    [ODOO_JOBS.SYNC_CATEGORY]: (job) => this.syncCategory(job.data as SyncCategoryPayload),
    [ODOO_JOBS.DELETE_CATEGORY]: (job) => this.deleteCategory(job.data as DeleteCategoryPayload),
    [ODOO_JOBS.SYNC_PRODUCT]: (job) => this.syncProduct(job.data as SyncProductPayload),
    [ODOO_JOBS.DELETE_PRODUCT]: (job) => this.deleteProduct(job.data as DeleteProductPayload),
    [ODOO_JOBS.UPDATE_PRICING]: (job) => this.updatePricing(job.data as UpdatePricingPayload),
    [ODOO_JOBS.CREATE_WAREHOUSE]: (job) => this.createWarehouse(job.data as CreateWarehousePayload),
    [ODOO_JOBS.SYNC_WAREHOUSE]: (job) => this.syncWarehouse(job.data as SyncWarehousePayload),
    [ODOO_JOBS.SYNC_UNIT]: (job) => this.syncUnit(job.data as SyncUnitPayload),
    [ODOO_JOBS.DELETE_UNIT]: (job) => this.deleteUnit(job.data as DeleteUnitPayload),
    [ODOO_JOBS.SYNC_CONDITION]: (job) => this.syncCondition(job.data as SyncConditionPayload),
    [ODOO_JOBS.DELETE_CONDITION]: (job) => this.deleteCondition(job.data as DeleteConditionPayload),
    [ODOO_JOBS.SYNC_FLEET]: () => this.syncFleet(),
    [ODOO_JOBS.PUSH_DRIVER_REQUEST]: (job) => this.pushDriverRequest(job.data as PushDriverRequestPayload),
    [ODOO_JOBS.PUSH_SHIFT_CHANGE]: (job) => this.pushShiftChange(job.data as PushShiftChangePayload),
    [ODOO_JOBS.APPLY_DRIVER_DECISION]: (job) => this.applyDriverDecision(job.data as DriverDecisionPayload),
    [ODOO_JOBS.APPLY_SHIFT_CHANGE_DECISION]: (job) =>
      this.applyShiftChangeDecision(job.data as ShiftChangeDecisionPayload),
  };

  async process(job: Job): Promise<unknown> {
    const handler = this.handlers[job.name];
    if (!handler) {
      winstonLogger.warn(`Unknown Odoo job: ${job.name}`, LOG_META);
      return null;
    }

    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    try {
      return await handler(job);
    } catch (error) {
      winstonLogger.error(
        `Job ${job.name} failed (attempt ${job.attemptsMade + 1}): ${(error as Error).message}`,
        { ...LOG_META, stack: (error as Error).stack },
      );
      if (isLastAttempt) {
        await this.compensate(job).catch((e) =>
          winstonLogger.error(`Compensation failed: ${(e as Error).message}`, {
            ...LOG_META,
            stack: (e as Error).stack,
          }),
        );
      }
      throw error;
    }
  }

  // --- Categories -----------------------------------------------------------
  private async syncCategory(payload: SyncCategoryPayload) {
    const category = await this.categoryRepo.findOne({ where: { id: payload.categoryId } });
    if (!category) return;

    if (category.odooCategoryId) {
      await this.odoo.updateProductCategory(category.odooCategoryId, { name: category.name });
    } else {
      const odooId = await this.odoo.createProductCategory(category.name);
      category.odooCategoryId = odooId;
    }
    category.odooSyncStatus = OdooSyncStatus.SYNCED;
    await this.categoryRepo.save(category);
  }

  private async deleteCategory(payload: DeleteCategoryPayload) {
    await this.odoo.deleteProductCategory(payload.odooCategoryId);
  }

  // --- Products -------------------------------------------------------------
  private async syncProduct(payload: SyncProductPayload) {
    const product = await this.productRepo.findOne({
      where: { id: payload.productId },
      relations: ['category'],
    });
    if (!product) return;

    if (product.odooProductId) {
      await this.odoo.updateProduct(product.odooProductId, { name: product.name });
    } else {
      // recycle.product requires a category — the category must be synced first.
      if (!product.category?.odooCategoryId) {
        throw new Error(
          `Category for product ${product.id} is not synced to Odoo yet`,
        );
      }
      const odooId = await this.odoo.createProduct({
        name: product.name,
        categoryOdooId: product.category.odooCategoryId,
      });
      product.odooProductId = odooId;
    }
    product.odooSyncStatus = OdooSyncStatus.SYNCED;
    await this.productRepo.save(product);

    // Whenever the product is (re)synced, keep its tier prices in Odoo current.
    await this.pushTierPrices(product);
  }

  private async deleteProduct(payload: DeleteProductPayload) {
    await this.odoo.deleteProduct(payload.odooProductId);
  }

  // --- Pricing --------------------------------------------------------------
  /**
   * Pushes the factory & free-facility tier prices to Odoo. Only these two tiers
   * place warehouse orders, so Odoo invoices with them — the other tiers live in
   * the backend only.
   */
  private async updatePricing(payload: UpdatePricingPayload) {
    const product = await this.productRepo.findOne({ where: { id: payload.productId } });
    if (!product?.odooProductId) return;
    await this.pushTierPrices(product);
  }

  /**
   * Pushes FACTORY / FREE_FACILITY prices to Odoo **per material condition**
   * (recycle.product.condition.price) — Odoo invoices warehouse orders for
   * these two tiers with a price per grade (excellent/good/...). The other
   * tiers (individual/company) live in the backend only, single price each.
   */
  private async pushTierPrices(product: Product): Promise<void> {
    if (!product.odooProductId) return;

    const tiers: Array<[PricingTier, 'factory' | 'free_facility']> = [
      [PricingTier.FACTORY, 'factory'],
      [PricingTier.FREE_FACILITY, 'free_facility'],
    ];

    for (const [tier, odooTier] of tiers) {
      const rows = await this.livePricingRows(product.id, tier);
      await this.odoo.replaceConditionPrices(
        product.odooProductId,
        odooTier,
        rows
          .filter((r) => r.conditionCode)
          .map((r) => ({ conditionCode: r.conditionCode!, price: Number(r.price) })),
      );
    }
  }

  /** All currently-effective pricing rows of a product for a given tier. */
  private async livePricingRows(productId: string, tier: PricingTier) {
    return this.pricingRepo
      .createQueryBuilder('pp')
      .where('pp.productId = :productId', { productId })
      .andWhere('pp.tier = :tier', { tier })
      .andWhere('pp.effectiveFrom <= NOW()')
      .andWhere('(pp.effectiveUntil IS NULL OR pp.effectiveUntil > NOW())')
      .getMany();
  }

  // --- Warehouse creation (backend → Odoo) ----------------------------------
  /**
   * Pushes a backend-created warehouse to Odoo (recycle.warehouse + zones).
   * On final failure the compensation step removes the orphan backend row.
   */
  private async createWarehouse(payload: CreateWarehousePayload) {
    const warehouse = await this.warehouseRepo.findOne({ where: { id: payload.warehouseId } });
    if (!warehouse) return;

    // Idempotent: if a previous attempt already created it in Odoo, just finish.
    if (warehouse.odooWarehouseId) {
      warehouse.odooSyncStatus = OdooSyncStatus.SYNCED;
      await this.warehouseRepo.save(warehouse);
      return;
    }

    const odooId = await this.odoo.createRecycleWarehouse({
      name: warehouse.name,
      code: warehouse.code,
      latitude: warehouse.latitude != null ? Number(warehouse.latitude) : undefined,
      longitude: warehouse.longitude != null ? Number(warehouse.longitude) : undefined,
      governorate: warehouse.governorate ?? undefined,
      zones: warehouse.zones ?? undefined,
    });

    warehouse.odooWarehouseId = odooId;
    warehouse.odooSyncStatus = OdooSyncStatus.SYNCED;
    warehouse.lastOdooSync = new Date();
    await this.warehouseRepo.save(warehouse);
  }

  // --- Measurement units (backend → Odoo) ------------------------------------
  /**
   * Pushes a unit (name, code, allows_tolerance) to the Odoo warehouse addon.
   * The sorting flow there enforces quantity matching per unit: tolerance-free
   * units (PIECE) must be sorted at exactly the shipment's declared quantity.
   */
  private async syncUnit(payload: SyncUnitPayload) {
    const unit = await this.unitRepo.findOne({ where: { id: payload.unitId } });
    if (!unit) return;

    if (unit.odooUnitId) {
      await this.odoo.updateMeasurementUnit(unit.odooUnitId, {
        name: unit.nameEn,
        code: unit.code,
        allows_tolerance: unit.allowsTolerance,
      });
    } else {
      unit.odooUnitId = await this.odoo.createMeasurementUnit({
        name: unit.nameEn,
        code: unit.code,
        allowsTolerance: unit.allowsTolerance,
      });
    }
    unit.odooSyncStatus = OdooSyncStatus.SYNCED;
    await this.unitRepo.save(unit);
  }

  private async deleteUnit(payload: DeleteUnitPayload) {
    await this.odoo.deleteMeasurementUnit(payload.odooUnitId);
  }

  // --- Material conditions (backend -> Odoo) ----------------------------------
  /** Pushes an admin-managed grade so the Odoo sorting UI can offer it. */
  private async syncCondition(payload: SyncConditionPayload) {
    const condition = await this.conditionRepo.findOne({ where: { id: payload.conditionId } });
    if (!condition) return;

    if (condition.odooConditionId) {
      await this.odoo.updateMaterialCondition(condition.odooConditionId, {
        name: condition.nameEn,
        code: condition.code,
        sort_order: condition.sortOrder,
      });
    } else {
      condition.odooConditionId = await this.odoo.createMaterialCondition({
        name: condition.nameEn,
        code: condition.code,
        sortOrder: condition.sortOrder,
      });
    }
    condition.odooSyncStatus = OdooSyncStatus.SYNCED;
    await this.conditionRepo.save(condition);
  }

  private async deleteCondition(payload: DeleteConditionPayload) {
    await this.odoo.deleteMaterialCondition(payload.odooConditionId);
  }

  // --- Warehouse info + inventory (Odoo → backend) ----------------------------
  /**
   * Mirrors one warehouse FROM Odoo: master data (name/code — Odoo-side edits
   * win) and then the stock lines. Triggered by the admin sync endpoint and by
   * the Odoo webhooks, so any change in Odoo lands here within seconds.
   */
  private async syncWarehouse(payload: SyncWarehousePayload) {
    const warehouse = await this.warehouseRepo.findOne({ where: { id: payload.warehouseId } });
    if (!warehouse) return;

    // 1) Warehouse master data (Odoo is the editing surface after creation).
    const info = await this.odoo.fetchWarehouseInfo(warehouse.odooWarehouseId);
    if (info) {
      if (info.name) warehouse.name = info.name;
      if (info.code) warehouse.code = info.code;
    }

    // 2) Stock lines — one mirror row per (product, condition). The sorter in
    //    Odoo grades every processed quantity, so lines carry condition_code;
    //    unsorted stock arrives without one and lands under UNGRADED.
    const lines = await this.odoo.fetchWarehouseInventory(warehouse.odooWarehouseId);

    const seenRowIds = new Set<string>();
    for (const line of lines) {
      const odooProductId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
      const productName = Array.isArray(line.product_id) ? line.product_id[1] : undefined;
      const conditionCode =
        typeof line.condition_code === 'string' && line.condition_code
          ? line.condition_code.toUpperCase()
          : UNGRADED_CONDITION;

      let row = await this.inventoryRepo.findOne({
        where: { warehouseId: warehouse.id, odooProductId, conditionCode },
      });
      if (!row) {
        row = this.inventoryRepo.create({ warehouseId: warehouse.id, odooProductId, conditionCode });
      }
      row.productName = productName ?? row.productName;
      row.quantity = String(line.quantity ?? 0);
      row.reservedQuantity = String(line.reserved_quantity ?? 0);
      row.syncedAt = new Date();
      const saved = await this.inventoryRepo.save(row);
      seenRowIds.add(saved.id);
    }

    // Remove mirror rows Odoo no longer reports (e.g. a grade fully shipped out).
    const existing = await this.inventoryRepo.find({ where: { warehouseId: warehouse.id } });
    for (const row of existing) {
      if (!seenRowIds.has(row.id)) await this.inventoryRepo.delete(row.id);
    }

    warehouse.lastOdooSync = new Date();
    await this.warehouseRepo.save(warehouse);
    return { synced: lines.length };
  }


  // --- Fleet mirror (Odoo -> backend) ----------------------------------------
  /**
   * Odoo is the fleet MASTER: trucks (with their warehouse), shifts and
   * driver-truck assignments are authored there and mirrored here so the
   * driver app and admin read views keep working locally.
   */
  private async syncFleet() {
    // 1) Shifts (match by odoo id, fall back to name for the seeded ones).
    const odooShifts = await this.odoo.fetchShifts();
    for (const os of odooShifts) {
      let shift =
        (await this.shiftRepo.findOne({ where: { odooShiftId: os.id } })) ??
        (await this.shiftRepo.findOne({ where: { name: os.name } }));
      if (!shift) shift = this.shiftRepo.create({ name: os.name });
      shift.odooShiftId = os.id;
      shift.name = os.name ?? shift.name;
      if (os.start_time) shift.startTime = os.start_time;
      if (os.end_time) shift.endTime = os.end_time;
      await this.shiftRepo.save(shift);
    }

    // 2) Trucks (linked to their warehouse via odooWarehouseId).
    const odooTrucks = await this.odoo.fetchTrucks();
    for (const ot of odooTrucks) {
      const warehouseOdooId = Array.isArray(ot.warehouse_id) ? ot.warehouse_id[0] : ot.warehouse_id;
      const warehouse = warehouseOdooId
        ? await this.warehouseRepo.findOne({ where: { odooWarehouseId: warehouseOdooId } })
        : null;

      let truck = await this.truckRepo.findOne({ where: { odooTruckId: ot.id } });
      if (!truck) truck = this.truckRepo.create({ odooTruckId: ot.id, status: TruckStatus.ACTIVE });
      truck.model = ot.model ?? truck.model ?? '';
      truck.year = ot.year ?? truck.year ?? 0;
      truck.plateNumber = ot.plate_number ?? truck.plateNumber;
      truck.maxPayloadKg = ot.max_payload_kg ?? truck.maxPayloadKg;
      truck.warehouseId = warehouse?.id ?? null;
      if (ot.is_active === false) truck.status = TruckStatus.DISABLED;
      else if (truck.status === TruckStatus.DISABLED) truck.status = TruckStatus.ACTIVE;
      await this.truckRepo.save(truck);
    }

    // 3) Driver assignments (decided by the Odoo admin; mirrored 1:1).
    const odooAssignments = await this.odoo.fetchDriverAssignments();
    const seen = new Set<string>();
    for (const oa of odooAssignments) {
      const driver = await this.collectorRepo.findOne({ where: { id: oa.backend_driver_id } });
      const truckOdooId = Array.isArray(oa.truck_id) ? oa.truck_id[0] : oa.truck_id;
      const shiftOdooId = Array.isArray(oa.shift_id) ? oa.shift_id[0] : oa.shift_id;
      const truck = await this.truckRepo.findOne({ where: { odooTruckId: truckOdooId } });
      const shift = await this.shiftRepo.findOne({ where: { odooShiftId: shiftOdooId } });
      if (!driver || !truck || !shift) continue; // not mirrorable yet — next sync will catch it

      let row =
        (await this.assignmentRepo.findOne({ where: { odooAssignmentId: oa.id } })) ??
        (await this.assignmentRepo.findOne({ where: { driverId: driver.id } }));
      if (!row) {
        row = this.assignmentRepo.create({ assignedAt: new Date() });
      }
      row.odooAssignmentId = oa.id;
      row.driverId = driver.id;
      row.truckId = truck.id;
      row.shiftId = shift.id;
      await this.assignmentRepo.save(row);
      seen.add(row.id);

      // Keep the driver's own shift aligned with the assignment.
      if (driver.shiftId !== shift.id) {
        driver.shiftId = shift.id;
        await this.collectorRepo.save(driver);
      }
    }
    // Assignments removed in Odoo disappear here too (Odoo is the master).
    const mirrored = await this.assignmentRepo
      .createQueryBuilder('a')
      .where('a.odooAssignmentId IS NOT NULL')
      .getMany();
    for (const row of mirrored) {
      if (!seen.has(row.id)) await this.assignmentRepo.delete(row.id);
    }

    // 4) Derived truck statuses (capacity = number of shifts).
    const capacity = await this.shiftRepo.count();
    const trucks = await this.truckRepo.find();
    for (const truck of trucks) {
      if (truck.status === TruckStatus.DISABLED) continue;
      const count = await this.assignmentRepo.count({ where: { truckId: truck.id } });
      truck.status =
        count === 0 ? TruckStatus.ACTIVE : count >= capacity ? TruckStatus.FULLY_BUSY : TruckStatus.BUSY_ONE_DRIVER;
      await this.truckRepo.save(truck);
    }

    return { shifts: odooShifts.length, trucks: odooTrucks.length, assignments: odooAssignments.length };
  }

  // --- Driver requests (backend -> Odoo -> backend) ----------------------------
  /** A collector finished onboarding: the request is reviewed by the ODOO admin. */
  private async pushDriverRequest(payload: PushDriverRequestPayload) {
    const account = await this.accountRepo.findOne({ where: { id: payload.accountId } });
    if (!account) return;
    const profile = await this.collectorRepo.findOne({ where: { account: { id: account.id } } });
    if (!profile) return;

    await this.odoo.createDriverRequest({
      backendDriverId: profile.id,
      name: account.name,
      email: account.email,
      phone: account.phone ?? null,
    });
  }

  /** Odoo admin decided on a driver request (and possibly assigned a truck). */
  private async applyDriverDecision(payload: DriverDecisionPayload) {
    const profile = await this.collectorRepo.findOne({
      where: { id: payload.backendDriverId },
      relations: ['account'],
    });
    if (!profile?.account) return;

    // Odoo controls the whole driver lifecycle: explicit status wins
    // (BLOCKED / NEED_CHANGES / ...); plain approved maps to ACTIVE/REJECTED.
    const newStatus =
      (payload.status as AccountStatus | undefined) ??
      (payload.approved ? AccountStatus.ACTIVE : AccountStatus.REJECTED);
    await this.accountRepo.update(profile.account.id, { accountStatus: newStatus });

    if (newStatus === AccountStatus.ACTIVE && payload.truckOdooId && payload.shiftOdooId) {
      const truck = await this.truckRepo.findOne({ where: { odooTruckId: payload.truckOdooId } });
      const shift = await this.shiftRepo.findOne({ where: { odooShiftId: payload.shiftOdooId } });
      if (truck && shift) {
        let row = await this.assignmentRepo.findOne({ where: { driverId: profile.id } });
        if (!row) row = this.assignmentRepo.create({ driverId: profile.id, assignedAt: new Date() });
        row.truckId = truck.id;
        row.shiftId = shift.id;
        await this.assignmentRepo.save(row);
        profile.shiftId = shift.id;
        await this.collectorRepo.save(profile);
      }
    }

    const statusMessages: Record<string, [string, string]> = {
      [AccountStatus.ACTIVE]: ['Driver request approved', 'Your driver account has been approved.'],
      [AccountStatus.REJECTED]: ['Driver request rejected', `Your driver request was rejected. ${payload.rejectionReason ?? ''}`.trim()],
      [AccountStatus.BLOCKED]: ['Account blocked', `Your driver account has been blocked. ${payload.rejectionReason ?? ''}`.trim()],
      [AccountStatus.NEED_CHANGES]: ['Changes requested', `Please update your information. ${payload.rejectionReason ?? ''}`.trim()],
    };
    const [title, body] = statusMessages[newStatus] ?? statusMessages[AccountStatus.REJECTED];
    await this.notifyDriver(profile.account.id, title, body);
  }

  // --- Shift-change requests (backend -> Odoo -> backend) ----------------------
  /** Mirrors a driver's shift-change request to Odoo where the admin decides. */
  private async pushShiftChange(payload: PushShiftChangePayload) {
    const request = await this.shiftChangeRepo.findOne({
      where: { id: payload.requestId },
      relations: ['driver', 'driver.account', 'truck', 'shift'],
    });
    if (!request) return;

    const odooId = await this.odoo.createShiftChangeRequest({
      backendRequestId: request.id,
      backendDriverId: request.driverId,
      driverName: request.driver?.account?.name ?? '',
      truckOdooId: request.truck?.odooTruckId ?? null,
      shiftOdooId: request.shift?.odooShiftId ?? null,
    });
    request.odooRequestId = odooId;
    await this.shiftChangeRepo.save(request);
  }

  /** Applies the Odoo admin's decision: swap the assignment or reject with reason. */
  private async applyShiftChangeDecision(payload: ShiftChangeDecisionPayload) {
    const request = await this.shiftChangeRepo.findOne({
      where: { id: payload.requestId },
      relations: ['driver', 'driver.account', 'truck', 'shift'],
    });
    if (!request || request.status !== ShiftChangeRequestStatus.PENDING) return;

    if (!payload.approved) {
      request.status = ShiftChangeRequestStatus.REJECTED;
      request.rejectionReason = payload.rejectionReason ?? null;
      await this.shiftChangeRepo.save(request);
      if (request.driver?.account) {
        await this.notifyDriver(
          request.driver.account.id,
          'Shift change rejected',
          `Your shift change request was rejected. ${payload.rejectionReason ?? ''}`.trim(),
          'notifications.shiftChangeRejected.title',
          'notifications.shiftChangeRejected.body',
          { reason: payload.rejectionReason ?? '-' },
        );
      }
      return;
    }

    // Approved: move the driver's assignment to the requested truck + shift.
    let row = await this.assignmentRepo.findOne({ where: { driverId: request.driverId } });
    if (!row) row = this.assignmentRepo.create({ driverId: request.driverId, assignedAt: new Date() });
    row.truckId = request.truckId;
    row.shiftId = request.shiftId;
    await this.assignmentRepo.save(row);

    if (request.driver) {
      request.driver.shiftId = request.shiftId;
      await this.collectorRepo.save(request.driver);
    }

    request.status = ShiftChangeRequestStatus.ACCEPTED;
    await this.shiftChangeRepo.save(request);

    if (request.driver?.account) {
      await this.notifyDriver(
        request.driver.account.id,
        'Shift change accepted',
        `Your shift change request was approved; you are now on truck "${request.truck?.plateNumber ?? ''}".`,
        'notifications.shiftChangeAccepted.title',
        'notifications.shiftChangeAccepted.body',
        { plate: request.truck?.plateNumber ?? '-' },
      );
    }
  }

  private async notifyDriver(
    accountId: string,
    title: string,
    body: string,
    titleKey?: string,
    bodyKey?: string,
    args?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const n = await this.notifications.createNotification({
        userId: accountId,
        title,
        body,
        titleKey,
        bodyKey,
        args,
        type: NotificationType.GENERAL,
      });
      await this.notifications.enqueueNotification(n.id);
    } catch (error) {
      winstonLogger.warn(`Failed to notify driver: ${(error as Error).message}`, LOG_META);
    }
  }

  // --- Compensation ---------------------------------------------------------
  private async compensate(job: Job): Promise<void> {
    if (job.name === ODOO_JOBS.SYNC_CATEGORY) {
      const { categoryId } = job.data as SyncCategoryPayload;
      const category = await this.categoryRepo.findOne({ where: { id: categoryId } });
      if (category && !category.odooCategoryId) {
        await this.categoryRepo.delete(categoryId);
        await this.notifyAdmins({
          title: 'Category sync failed',
          body: `The category "${category.name}" could not be synced to Odoo and was removed.`,
          titleKey: 'notifications.categorySyncFailed.title',
          bodyKey: 'notifications.categorySyncFailed.body',
          args: { name: category.name },
        });
      } else if (category) {
        category.odooSyncStatus = OdooSyncStatus.FAILED;
        await this.categoryRepo.save(category);
      }
    }

    if (job.name === ODOO_JOBS.SYNC_PRODUCT) {
      const { productId } = job.data as SyncProductPayload;
      const product = await this.productRepo.findOne({ where: { id: productId } });
      if (product && !product.odooProductId) {
        await this.productRepo.delete(productId);
        await this.notifyAdmins({
          title: 'Product sync failed',
          body: `The product "${product.name}" could not be synced to Odoo and was removed.`,
          titleKey: 'notifications.productSyncFailed.title',
          bodyKey: 'notifications.productSyncFailed.body',
          args: { name: product.name },
        });
      } else if (product) {
        product.odooSyncStatus = OdooSyncStatus.FAILED;
        await this.productRepo.save(product);
      }
    }

    if (job.name === ODOO_JOBS.SYNC_UNIT) {
      const { unitId } = job.data as SyncUnitPayload;
      const unit = await this.unitRepo.findOne({ where: { id: unitId } });
      if (unit && !unit.odooUnitId) {
        // Never reached Odoo → remove it so sorting rules can't silently diverge.
        await this.unitRepo.delete(unitId);
        await this.notifyAdmins({
          title: 'Unit sync failed',
          body: `The measurement unit "${unit.code}" could not be synced to Odoo and was removed.`,
          titleKey: 'notifications.unitSyncFailed.title',
          bodyKey: 'notifications.unitSyncFailed.body',
          args: { name: unit.code },
        });
      } else if (unit) {
        unit.odooSyncStatus = OdooSyncStatus.FAILED;
        await this.unitRepo.save(unit);
      }
    }

    if (job.name === ODOO_JOBS.SYNC_CONDITION) {
      const { conditionId } = job.data as SyncConditionPayload;
      const condition = await this.conditionRepo.findOne({ where: { id: conditionId } });
      if (condition && !condition.odooConditionId) {
        await this.conditionRepo.delete(conditionId);
        await this.notifyAdmins({
          title: 'Condition sync failed',
          body: `The material condition "${condition.code}" could not be synced to Odoo and was removed.`,
          titleKey: 'notifications.conditionSyncFailed.title',
          bodyKey: 'notifications.conditionSyncFailed.body',
          args: { name: condition.code },
        });
      } else if (condition) {
        condition.odooSyncStatus = OdooSyncStatus.FAILED;
        await this.conditionRepo.save(condition);
      }
    }

    if (job.name === ODOO_JOBS.CREATE_WAREHOUSE) {
      const { warehouseId } = job.data as CreateWarehousePayload;
      const warehouse = await this.warehouseRepo.findOne({ where: { id: warehouseId } });
      if (warehouse && !warehouse.odooWarehouseId) {
        // Never created in Odoo → remove the orphan backend row.
        await this.warehouseRepo.delete(warehouseId);
        await this.notifyAdmins({
          title: 'Warehouse creation failed',
          body: `The warehouse "${warehouse.name}" could not be created in Odoo and was removed.`,
          titleKey: 'notifications.warehouseCreateFailed.title',
          bodyKey: 'notifications.warehouseCreateFailed.body',
          args: { name: warehouse.name },
        });
      } else if (warehouse) {
        warehouse.odooSyncStatus = OdooSyncStatus.FAILED;
        await this.warehouseRepo.save(warehouse);
      }
    }
  }

  private async notifyAdmins(content: {
    title: string;
    body: string;
    titleKey: string;
    bodyKey: string;
    args?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const admins = await this.accountRepo.find({ where: { role: Role.ADMIN } });
      for (const admin of admins) {
        const n = await this.notifications.createNotification({
          userId: admin.id,
          title: content.title,
          body: content.body,
          titleKey: content.titleKey,
          bodyKey: content.bodyKey,
          args: content.args,
          type: NotificationType.ODOO,
        });
        await this.notifications.enqueueNotification(n.id);
      }
    } catch (error) {
      winstonLogger.warn(`Failed to notify admins of Odoo failure: ${(error as Error).message}`, {
        ...LOG_META,
        stack: (error as Error).stack,
      });
    }
  }
}
