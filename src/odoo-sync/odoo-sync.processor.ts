import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Job, Queue } from 'bullmq';
import { OdooService } from '@src/odoo/odoo.service';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { ProductPricing } from '@src/waste-management/entities/product-pricing.entity';
import { Offer } from '@src/waste-management/entities/offer.entity';
import {
  OfferAudience,
  offerPercentage,
  priceAfterOffer,
} from '@src/waste-management/enums/offer-audience.enum';
import { MeasurementUnit } from '@src/waste-management/entities/measurement-unit.entity';
import {
  MaterialCondition,
  UNGRADED_CONDITION,
} from '@src/waste-management/entities/material-condition.entity';
import { OdooSyncStatus } from '@src/waste-management/enums/odoo-sync-status.enum';
import { PricingTier } from '@src/waste-management/enums/pricing-tier.enum';
import { Account } from '@src/user/entities/account.entity';
import { Province } from '@src/user/entities/location/province.entity';
import { Role } from '@src/user/enums/role.enum';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { warehouseStateFromOdoo } from '@src/warehouse/enums/warehouse-state.enum';
import { DeliveryTariff } from '@src/warehouse/entities/delivery-tariff.entity';
import { tariffScopeFromOdoo } from '@src/warehouse/enums/delivery-tariff-scope.enum';
import { Order } from '@src/order/entities/order.entity';
import { OrderPart } from '@src/order/entities/order-part.entity';
import { OrderPartOffer } from '@src/order/entities/order-part-offer.entity';
import { latestRoundWasSplit } from '@src/order/latest-round-split';
import { FulfilmentMode } from '@src/order/enums/fulfilment-mode.enum';
import { DeliveryRateService } from '@src/warehouse/providers/delivery-rate.service';
import { CatalogCacheService } from '@src/waste-management/common/providers/catalog-cache.service';
import {
  OrderStatus,
  canTransition,
  TERMINAL_ORDER_STATUSES,
} from '@src/order/enums/order-status.enum';
import {
  OrderPartStatus,
  canTransitionPart,
  FAILED_PART_STATUSES,
} from '@src/order/enums/order-part-status.enum';
import { ORDER_TASKS, ORDER_TASKS_QUEUE } from '@src/order/order-tasks.constants';
import {
  autoAdvanceAfterPreparation,
  resolvePartStatus,
} from '@src/order/order-event-map';
import { deriveOrderStatus } from '@src/order/derive-order-status';
import { DistanceCache } from '@src/order/entities/distance-cache.entity';
import { TruckEntity } from '@src/truck/entities/truck.entity';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { ShiftChangeRequest } from '@src/truck/entities/shift-change-request.entity';
import { ShiftChangeRequestStatus } from '@src/truck/enums/shift-change-request-status.enum';
import { TruckProblem } from '@src/truck/entities/truck-problem.entity';
import { TruckHandover } from '@src/truck/entities/truck-handover.entity';
import { TruckStatus } from '@src/truck/enums/truck-status.enum';
import { Shift, ShiftType } from '@src/shift/entities/shift.entity';
import { CollectorProfile } from '@src/user/entities/profile/collector-profile.entity';
import { UserDevice } from '@src/auth/entities/user-device.entity';
import { Media, OwnerType, statusMedia } from '@src/media/entities/media.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { WarehouseManager } from '@src/warehouse/entities/warehouse-manager.entity';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { truckTypeFromOdoo, TruckType } from '@src/truck/enums/truck-type.enum';
import {
  CancelShiftChangePayload,
  CreateWarehousePayload,
  DeleteCategoryPayload,
  DeleteProductPayload,
  DeleteConditionPayload,
  DeleteProvincePayload,
  CancelOrderPartPayload,
  OrderEventPayload,
  TransferStockGradePayload,
  PushDeliveryTripPayload,
  PushComplaintPayload,
  PushOrderPartPayload,
  UpdateWarehousePayload,
  DeleteUnitPayload,
  DriverDecisionPayload,
  PushDriverRequestPayload,
  PushHandoverPayload,
  RegisterIntakePayload,
  PushShiftChangePayload,
  PushTruckProblemPayload,
  ShiftChangeDecisionPayload,
  ODOO_JOBS,
  ODOO_SYNC_QUEUE,
  SyncCategoryPayload,
  SyncConditionPayload,
  SyncProductPayload,
  SyncProvincePayload,
  SyncUnitPayload,
  SyncWarehousePayload,
  UpdatePricingPayload,
} from './odoo-sync.constants';

/** Unified logging context/channel for all Odoo-sync worker output. */
const LOG_META = { context: 'OdooSyncProcessor', channel: 'jobs' } as const;

/** One (product, condition) bucket while summing Odoo's per-zone stock rows. */
interface InventoryTotal {
  odooProductId: number;
  conditionCode: string;
  productName?: string;
  quantity: number;
  reserved: number;
}

/**
 * Odoo stores shift times as a FLOAT hour (8 = 08:00, 17.0333… = 17:02) while
 * our `shifts.start_time` / `end_time` are Postgres `time` columns. Passing the
 * raw number through made every fleet sync die with
 * `invalid input syntax for type time: "8"`, which silently froze the whole
 * mirror — so the conversion happens here, once.
 *
 * Returns null for a missing/invalid value (the caller then keeps the previous
 * value). Note 0 is VALID (midnight) and must not be treated as absent.
 */
function odooFloatToTime(value: unknown): string | null {
  const f = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(f) || f < 0) return null;
  // Round to the nearest minute, carrying 59.5+ up to the next hour and
  // wrapping 24:00 back to 00:00.
  const totalMinutes = Math.round(f * 60) % (24 * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

@Processor(ODOO_SYNC_QUEUE)
export class OdooSyncProcessor extends WorkerHost {
  constructor(
    private readonly odoo: OdooService,
    private readonly notifications: NotificationService,
    // Enqueued (not consumed here): starting a consolidation once its last
    // warehouse has prepared. The order module consumes this queue.
    @InjectQueue(ORDER_TASKS_QUEUE) private readonly orderTasks: Queue,
    @InjectRepository(WasteCategory)
    private readonly categoryRepo: Repository<WasteCategory>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductPricing)
    private readonly pricingRepo: Repository<ProductPricing>,
    // Read-only: the offer mirror pushed onto Odoo's price sheet.
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    @InjectRepository(WarehouseInventory)
    private readonly inventoryRepo: Repository<WarehouseInventory>,
    @InjectRepository(WarehouseManager)
    private readonly warehouseManagerRepo: Repository<WarehouseManager>,
    @InjectRepository(MeasurementUnit)
    private readonly unitRepo: Repository<MeasurementUnit>,
    @InjectRepository(MaterialCondition)
    private readonly conditionRepo: Repository<MaterialCondition>,
    @InjectRepository(Province)
    private readonly provinceRepo: Repository<Province>,
    @InjectRepository(DeliveryTariff)
    private readonly tariffRepo: Repository<DeliveryTariff>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderPart)
    private readonly orderPartRepo: Repository<OrderPart>,
    @InjectRepository(OrderPartOffer)
    private readonly orderPartOfferRepo: Repository<OrderPartOffer>,
    @InjectRepository(DistanceCache)
    private readonly distanceCacheRepo: Repository<DistanceCache>,
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
    @InjectRepository(TruckProblem)
    private readonly truckProblemRepo: Repository<TruckProblem>,
    @InjectRepository(TruckHandover)
    private readonly handoverRepo: Repository<TruckHandover>,
    @InjectRepository(UserDevice)
    private readonly userDeviceRepo: Repository<UserDevice>,
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>,
    // Re-prices a reassigned split part's delivery leg. Provided by THIS module
    // (see the module note) to avoid a cycle with WarehouseModule.
    private readonly rates: DeliveryRateService,
    // Drops cached catalogue pages when a reverse product edit lands, so the
    // mirrored name is visible at once instead of at the next TTL.
    private readonly cache: CatalogCacheService,
  ) {
    super();
  }

  /** Job-name → handler dispatch map (same pattern as MailProcessor). */
  private readonly handlers: Record<string, (job: Job) => Promise<unknown>> = {
    [ODOO_JOBS.SYNC_CATEGORY]: (job) => this.syncCategory(job.data as SyncCategoryPayload),
    [ODOO_JOBS.DELETE_CATEGORY]: (job) => this.deleteCategory(job.data as DeleteCategoryPayload),
    [ODOO_JOBS.SYNC_PRODUCT]: (job) => this.syncProduct(job.data as SyncProductPayload),
    [ODOO_JOBS.DELETE_PRODUCT]: (job) => this.deleteProduct(job.data as DeleteProductPayload),
    [ODOO_JOBS.SYNC_PRODUCT_FROM_ODOO]: (job) =>
      this.syncProductFromOdoo(job.data as { odooProductId: number }),
    [ODOO_JOBS.UPDATE_PRICING]: (job) => this.updatePricing(job.data as UpdatePricingPayload),
    [ODOO_JOBS.CREATE_WAREHOUSE]: (job) => this.createWarehouse(job.data as CreateWarehousePayload),
    [ODOO_JOBS.SYNC_WAREHOUSE]: (job) => this.syncWarehouse(job.data as SyncWarehousePayload),
    [ODOO_JOBS.UPDATE_WAREHOUSE]: (job) => this.updateWarehouse(job.data as UpdateWarehousePayload),
    [ODOO_JOBS.SYNC_UNIT]: (job) => this.syncUnit(job.data as SyncUnitPayload),
    [ODOO_JOBS.DELETE_UNIT]: (job) => this.deleteUnit(job.data as DeleteUnitPayload),
    [ODOO_JOBS.SYNC_PROVINCE]: (job) => this.syncProvince(job.data as SyncProvincePayload),
    [ODOO_JOBS.DELETE_PROVINCE]: (job) => this.deleteProvince(job.data as DeleteProvincePayload),
    [ODOO_JOBS.SYNC_ALL_PROVINCES]: () => this.syncAllProvinces(),
    [ODOO_JOBS.SYNC_ALL_WAREHOUSES]: () => this.syncAllWarehouses(),
    [ODOO_JOBS.PUSH_ORDER_PART]: (job) => this.pushOrderPart(job.data as PushOrderPartPayload),
    [ODOO_JOBS.CANCEL_ORDER_PART]: (job) => this.cancelOrderPart(job.data as CancelOrderPartPayload),
    [ODOO_JOBS.APPLY_ORDER_EVENT]: (job) => this.applyOrderEvent(job.data as OrderEventPayload),
    [ODOO_JOBS.TRANSFER_STOCK_GRADE]: (job) => this.transferStockGrade(job.data as TransferStockGradePayload),
    [ODOO_JOBS.PUSH_DELIVERY_TRIP]: (job) => this.pushDeliveryTrip(job.data as PushDeliveryTripPayload),
    [ODOO_JOBS.PUSH_COMPLAINT]: (job) => this.pushComplaint(job.data as PushComplaintPayload),
    [ODOO_JOBS.SYNC_DELIVERY_TARIFFS]: () => this.syncDeliveryTariffs(),
    [ODOO_JOBS.SYNC_CONDITION]: (job) => this.syncCondition(job.data as SyncConditionPayload),
    [ODOO_JOBS.DELETE_CONDITION]: (job) => this.deleteCondition(job.data as DeleteConditionPayload),
    [ODOO_JOBS.SYNC_FLEET]: () => this.syncFleet(),
    [ODOO_JOBS.PUSH_DRIVER_REQUEST]: (job) => this.pushDriverRequest(job.data as PushDriverRequestPayload),
    [ODOO_JOBS.PUSH_SHIFT_CHANGE]: (job) => this.pushShiftChange(job.data as PushShiftChangePayload),
    [ODOO_JOBS.CANCEL_SHIFT_CHANGE]: (job) => this.cancelShiftChange(job.data as CancelShiftChangePayload),
    [ODOO_JOBS.PUSH_TRUCK_PROBLEM]: (job) => this.pushTruckProblem(job.data as PushTruckProblemPayload),
    [ODOO_JOBS.PUSH_HANDOVER_PICKUP]: (job) => this.pushHandoverPickup(job.data as PushHandoverPayload),
    [ODOO_JOBS.PUSH_HANDOVER_DROPOFF]: (job) => this.pushHandoverDropoff(job.data as PushHandoverPayload),
    [ODOO_JOBS.REGISTER_INTAKE]: (job) => this.pushRegisterIntake(job.data as RegisterIntakePayload),
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
      // Push EVERY mutable field the backend owns, not just the name — an edit
      // to the unit or the category never reached Odoo before, so a renamed
      // material synced but a re-measured one silently did not. `unit_code` is
      // resolved to Odoo's uom_id inside recycle.product.write; the category is
      // sent only once it has an Odoo id to point at.
      const values: Record<string, any> = { name: product.name };
      if (product.unitType) values.unit_code = product.unitType;
      if (product.category?.odooCategoryId) {
        values.category_id = product.category.odooCategoryId;
      }
      await this.odoo.updateProduct(product.odooProductId, values);
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
        // Odoo only accepts a unit it mirrors from this backend, so the
        // material carries its unit CODE across instead of being given
        // whatever default Odoo happens to hold.
        unitCode: product.unitType,
      });
      product.odooProductId = odooId;
    }
    product.odooSyncStatus = OdooSyncStatus.SYNCED;
    await this.productRepo.save(product);

    // Whenever the product is (re)synced, keep its tier prices in Odoo current.
    await this.pushTierPrices(product);
  }

  /**
   * REVERSE sync: a product's master field was edited on the Odoo screen; mirror
   * it back to the backend row.
   *
   * The backend stays the master for a product's EXISTENCE and its PRICING — this
   * only copies the editable master fields (the name) the other way, so the two
   * screens agree instead of the Odoo edit being silently lost.
   *
   * Loop-safe by construction: the write happens ONLY when the value actually
   * differs, and it NEVER enqueues a push back to Odoo. So the backend→Odoo push
   * (which also writes only on a real change) and this Odoo→backend mirror
   * converge after one hop and then both fall silent — there is no ping-pong.
   */
  private async syncProductFromOdoo(payload: { odooProductId: number }) {
    const product = await this.productRepo.findOne({
      where: { odooProductId: payload.odooProductId },
    });
    // Unknown here means Odoo authored a product the backend does not mirror —
    // and the backend is the only place a product may be BORN, so this is not
    // adopted. Nothing to do.
    if (!product) return;

    const info = await this.odoo.fetchProductInfo(payload.odooProductId);
    if (!info?.name) return;

    if (info.name !== product.name) {
      product.name = info.name;
      await this.productRepo.save(product);
      await this.cache.invalidate('products', 'categories', 'offers');
      winstonLogger.info(
        `Product ${product.id} name mirrored FROM Odoo (${payload.odooProductId})`,
        LOG_META,
      );
    }
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
      // Live offers for the buyers this tier serves, keyed by the grade each
      // one names. Odoo shows the list price struck through beside it, so the
      // administrator sees the change rather than only its result.
      const offers = await this.liveOffersByCondition(product.id, tier);

      await this.odoo.replaceConditionPrices(
        product.odooProductId,
        odooTier,
        // A material with no conditions is priced once for the tier; that row
        // has a null conditionCode and MUST travel too — filtering it out left
        // such materials priceless on the Odoo side.
        rows.map((r) => {
          const offer = offers.get(r.conditionCode ?? '');
          const base = Number(r.price);
          // The offer holds an AMOUNT, so the price Odoo shows is computed
          // here from THIS tier's own list price — the same helper the app and
          // the basket use, so the three cannot disagree about which way the
          // price moved or by how much.
          return {
            conditionCode: r.conditionCode ?? null,
            price: base,
            offerPrice: offer
              ? priceAfterOffer(base, Number(offer.amount), offer.audience)
              : 0,
            // Sent so the Odoo sheet can state the saving rather than leaving
            // the reader to work it out from two numbers.
            offerPercentage: offer
              ? offerPercentage(base, Number(offer.amount))
              : 0,
            offerValidUntil: offer?.validUntil ?? null,
          };
        }),
      );
    }
  }

  /**
   * Live offers for one material, aimed at the buyers of this tier, keyed by
   * the condition each names ('' for an offer on the plain price).
   *
   * Matched on ROLE rather than tier because that is how an offer is targeted:
   * a factory-tier price sheet is read by factories, so only offers reaching
   * factories belong on it. An untargeted offer reaches everyone and therefore
   * belongs on every sheet.
   */
  private async liveOffersByCondition(
    productId: string,
    tier: PricingTier,
  ): Promise<Map<string, Offer>> {
    const role = tier === PricingTier.FACTORY ? Role.FACTORY : Role.EXTERNAL_PARTNER;
    const rows = await this.offerRepo
      .createQueryBuilder('o')
      .where('o.productId = :productId', { productId })
      // This sheet is a BUYER's, so only a buyer offer belongs on it. Without
      // the filter a seller offer with no roles named — which reads as "both
      // roles of its audience" — matched the row below and was applied here as
      // an INCREASE, quietly raising what a factory is charged.
      .andWhere('o.audience = :audience', { audience: OfferAudience.BUYERS })
      .andWhere('(o.targetRoles IS NULL OR :role = ANY(o.targetRoles))', { role })
      .andWhere('o.isActive = true')
      .andWhere('o.validFrom <= NOW()')
      .andWhere('(o.validUntil IS NULL OR o.validUntil > NOW())')
      // Biggest reduction wins a tie on the same grade. Ordered by the AMOUNT,
      // not by a final price: the offer no longer stores one, and the column
      // this used to read (`offerPrice`) is gone — which failed every push with
      // "column o.offerprice does not exist", leaving the Odoo sheet frozen on
      // the numbers it happened to hold when the model changed.
      .orderBy('o.amount', 'DESC')
      .getMany();

    const map = new Map<string, Offer>();
    for (const o of rows) {
      const key = o.conditionCode ?? '';
      if (!map.has(key)) map.set(key, o);
    }
    return map;
  }

  /**
   * All currently-effective pricing rows of a product for a given tier —
   * EXCLUDING those on a deactivated grade.
   *
   * A deactivated grade is hidden everywhere a buyer looks, and Odoo's price
   * sheet is one of those places: leaving its price here would show the grade,
   * struck through or not, on the sorter's and the buyer's Odoo view while the
   * apps hide it. The ungraded row (null condition) always stays — it is the
   * material's plain price, not a grade.
   */
  private async livePricingRows(productId: string, tier: PricingTier) {
    return this.pricingRepo
      .createQueryBuilder('pp')
      .leftJoin('pp.condition', 'c')
      .where('pp.productId = :productId', { productId })
      .andWhere('pp.tier = :tier', { tier })
      .andWhere('pp.effectiveFrom <= NOW()')
      .andWhere('(pp.effectiveUntil IS NULL OR pp.effectiveUntil > NOW())')
      .andWhere('(pp.conditionId IS NULL OR c.isActive = true)')
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
      // Odoo now REQUIRES an address on creation, so it has to travel. Without
      // this every backend-created warehouse would be refused on the far side
      // and sit failing in the queue forever.
      address: warehouse.address ?? undefined,
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
    const condition = await this.conditionRepo.findOne({
      where: { id: payload.conditionId },
      relations: ['product'],
    });
    if (!condition) return;

    // The grade travels WITH its material. Odoo's sorter grades a specific
    // material, so a grade pushed without one would appear on every material's
    // picker — which is exactly the global list this move got rid of.
    const productOdooId = condition.product?.odooProductId;
    if (!productOdooId) {
      // The material has not reached Odoo yet; the product sync will bring the
      // grade along, and the reconcile pass re-pushes anything still missing.
      return;
    }

    if (condition.odooConditionId) {
      await this.odoo.updateMaterialCondition(condition.odooConditionId, {
        name: condition.nameEn,
        code: condition.code,
        sort_order: condition.sortOrder,
        // `product_id`, not `product_odoo_id` — the create branch four lines
        // below always got this right, so conditions could be created and never
        // updated: Odoo rejected the whole write with "Invalid field
        // 'product_odoo_id'". Nothing surfaced it, because a failed sync only
        // stamped the row FAILED and no code path ever read that column back.
        product_id: productOdooId,
      });
    } else {
      condition.odooConditionId = await this.odoo.createMaterialCondition({
        name: condition.nameEn,
        code: condition.code,
        sortOrder: condition.sortOrder,
        productOdooId,
      });
    }
    condition.odooSyncStatus = OdooSyncStatus.SYNCED;
    await this.conditionRepo.save(condition);
  }

  private async deleteCondition(payload: DeleteConditionPayload) {
    await this.odoo.deleteMaterialCondition(payload.odooConditionId);
  }

  /**
   * Pushes a backend warehouse edit to Odoo.
   *
   * Without this the two drifted: an admin renaming a warehouse here saw the new
   * name, while every Odoo screen, order and report kept the old one.
   */
  private async updateWarehouse(payload: UpdateWarehousePayload) {
    const warehouse = await this.warehouseRepo.findOne({
      where: { id: payload.warehouseId },
    });
    if (!warehouse?.odooWarehouseId) return;
    await this.odoo.updateRecycleWarehouse(warehouse.odooWarehouseId, {
      name: warehouse.name,
      code: warehouse.code,
      capacity: warehouse.capacity,
    });
    // Clears the drift signal the edit raised. Until this existed the column
    // only ever described the CREATE, so a lost edit was invisible.
    warehouse.odooSyncStatus = OdooSyncStatus.SYNCED;
    await this.warehouseRepo.save(warehouse);
  }

  // --- Buyer orders -----------------------------------------------------------
  /**
   * Pushes one part of a buyer's order into Odoo, where a warehouse works it.
   *
   * Idempotent on both sides: Odoo keys on the part id, and a part that already
   * carries an `odooOrderId` short-circuits here — a retry must never make a
   * second warehouse prepare the same goods.
   */
  private async pushOrderPart(payload: PushOrderPartPayload) {
    const part = await this.orderPartRepo.findOne({
      where: { id: payload.partId },
      relations: ['order', 'warehouse', 'lines'],
    });
    if (!part || part.odooOrderId) return;

    const warehouseOdooId = part.warehouse?.odooWarehouseId;
    if (!warehouseOdooId) {
      throw new Error(`Warehouse ${part.warehouseId} is not synced to Odoo yet`);
    }

    const account = await this.accountRepo.findOne({
      where: { id: part.order.buyerAccountId },
    });

    // How many parts this buyer order was split into, and which one this is.
    // Odoo needs both: a SPLIT order is approved by the administrator as one
    // decision, not by each warehouse manager for their own piece — a buyer
    // waiting on three warehouses should not have their order half-approved
    // and stuck. Without the group id Odoo sees three unrelated orders and has
    // no way to know they are one.
    const siblingCount = await this.orderPartRepo.count({
      where: { orderId: part.orderId },
    });

    const result = await this.odoo.pushOrderPart({
      part_id: part.id,
      order_id: part.orderId,
      part_sequence: part.sequence,
      part_count: siblingCount,
      factory_id: part.order.buyerProfileId,
      customer_name: account?.name ?? 'Buyer',
      customer_email: account?.email ?? undefined,
      warehouse_odoo_id: warehouseOdooId,
      // Odoo prices by buyer tier, and the two roles differ only in delivery.
      order_type:
        part.order.buyerRole === Role.FACTORY ? 'factory' : 'free_facility',
      lines: (part.lines ?? []).map((line) => ({
        product_odoo_id: line.odooProductId as number,
        quantity: Number(line.quantity),
        condition: line.conditionCode ?? null,
        price_unit: Number(line.unitPrice),
      })),
    });

    part.odooOrderId = result.odoo_id;
    await this.orderPartRepo.save(part);

    // Reserve only after the order exists in Odoo: the reservation lives on
    // that record, and reserving before it exists would leave stock held by
    // nothing.
    const reservation = await this.odoo.reserveOrderStock(result.odoo_id);
    part.stockReserved = reservation?.reserved === true;
    await this.orderPartRepo.save(part);

    if (!part.stockReserved) {
      winstonLogger.warn(
        `Order part ${part.id} could not reserve stock in ${part.warehouse?.name}`,
        LOG_META,
      );
    }
  }

  /** Push a planned delivery trip to Odoo for the driver to run. */
  private async pushDeliveryTrip(payload: PushDeliveryTripPayload) {
    await this.odoo.pushDeliveryTrip(payload.trip);
    winstonLogger.info(
      `Delivery trip ${payload.trip.trip_number} pushed to Odoo`,
      LOG_META,
    );
  }

  /** Notify a warehouse's manager in Odoo of a warehouse-routed complaint. */
  private async pushComplaint(payload: PushComplaintPayload) {
    const res = await this.odoo.notifyWarehouseComplaint({
      odooWarehouseId: payload.odooWarehouseId,
      kind: payload.kind,
      description: payload.description,
      orderNumber: payload.orderNumber,
    });
    winstonLogger.info(
      `Complaint ${payload.complaintId} sent to warehouse ${payload.odooWarehouseId} (notified: ${res?.notified})`,
      LOG_META,
    );
  }

  /** The buyer cancelled before the goods were committed. */
  private async cancelOrderPart(payload: CancelOrderPartPayload) {
    const part = await this.orderPartRepo.findOne({
      where: { id: payload.partId },
    });
    if (!part?.odooOrderId) return;
    await this.odoo.cancelOrderPart(part.id, payload.reason);
    part.stockReserved = false;
    await this.orderPartRepo.save(part);
  }

  /**
   * Re-grades unreserved stock in Odoo, which OWNS the quantity.
   *
   * The backend service pre-checked its mirror before enqueuing, but Odoo is the
   * authority — so a refusal here means the unreserved stock changed in between
   * (another movement, a fresh reservation). That is a business outcome, not a
   * transient fault: retrying will not grow the stock, so the admin is told and
   * the job stops rather than burning its attempts. A genuine RPC fault throws,
   * and is retried by the queue as usual.
   *
   * On success nothing is written here: Odoo's `recycle.stock` write fires an
   * inventory ping, and SYNC_WAREHOUSE refreshes the mirror with the truth —
   * the same channel every quantity change already flows through, so no new
   * reconciler is owed.
   */
  private async transferStockGrade(payload: TransferStockGradePayload) {
    const result = await this.odoo.transferStockGrade({
      warehouseOdooId: payload.warehouseOdooId,
      odooProductId: payload.odooProductId,
      fromCondition: payload.fromCondition,
      toCondition: payload.toCondition,
      quantity: payload.quantity,
    });

    if (!result?.transferred) {
      winstonLogger.warn(
        `Grade transfer refused by Odoo (product ${payload.odooProductId}, ` +
          `warehouse ${payload.warehouseId}): ${result?.movable ?? 0} movable of ${payload.quantity}`,
        LOG_META,
      );
      await this.notifyGradeTransferFailed(payload);
      return;
    }

    winstonLogger.info(
      `Grade transfer applied in Odoo: ${payload.quantity} of product ` +
        `${payload.odooProductId} from ${payload.fromCondition} to ${payload.toCondition} ` +
        `in warehouse ${payload.warehouseId}`,
      LOG_META,
    );
  }

  /** Tell the admin who asked that the re-grade could not be applied. */
  private async notifyGradeTransferFailed(
    payload: TransferStockGradePayload,
  ): Promise<void> {
    try {
      const product = await this.productRepo.findOne({
        where: { odooProductId: payload.odooProductId },
      });
      const name = product?.name ?? `#${payload.odooProductId}`;
      const n = await this.notifications.createNotification({
        userId: payload.adminId,
        title: 'Grade transfer could not be applied',
        body: `Re-grading stock of "${name}" was refused because the unreserved quantity changed.`,
        titleKey: 'notifications.gradeTransferFailed.title',
        bodyKey: 'notifications.gradeTransferFailed.body',
        args: { product: name },
        type: NotificationType.ODOO,
      });
      await this.notifications.enqueueNotification(n.id);
    } catch (error) {
      winstonLogger.warn(
        `Failed to notify admin of grade-transfer refusal: ${(error as Error).message}`,
        LOG_META,
      );
    }
  }

  /**
   * Applies one thing a warehouse did to the buyer's order.
   *
   * The event → status mapping is a lookup table, and an unrecognised event is
   * ignored rather than guessed at: inventing a status from an event we do not
   * understand is how an order ends up claiming to be somewhere it is not.
   */
  private async applyOrderEvent(payload: OrderEventPayload) {
    const part = await this.orderPartRepo.findOne({
      where: { id: payload.partId },
      relations: ['order'],
    });
    if (!part) {
      winstonLogger.warn(
        `Odoo reported on unknown order part ${payload.partId}`,
        LOG_META,
      );
      return;
    }

    // A reassignment is not a status change — it re-points the part at another
    // warehouse. Handled on its own and returned early, before the status map.
    if (payload.event === 'reassigned') {
      await this.applyReassignment(part, payload);
      return;
    }

    // Odoo may have created the order without our push recording the id.
    if (!part.odooOrderId) {
      part.odooOrderId = payload.odooOrderId;
    }
    if (payload.invoiceNumber) part.invoiceNumber = payload.invoiceNumber;
    if (payload.outputZone) part.outputZoneName = payload.outputZone;
    if (payload.rejectReason) part.rejectReason = payload.rejectReason;

    const target = resolvePartStatus(payload.event, payload.handoverType);
    if (target && canTransitionPart(part.status, target)) {
      part.status = target;
      this.stampPart(part, target);

      // A collection order is ready the instant it is prepared; a delivery
      // waits for the manager to release it to a carrier; a consolidation waits
      // for the gathering trip, so it stays in the output zone for now.
      const next = autoAdvanceAfterPreparation(
        target,
        part.order.fulfilmentMode,
        part.order.consolidate,
      );
      if (next && canTransitionPart(part.status, next)) {
        part.status = next;
      }
    }

    // Whatever stops the part also ends its hold on the stock.
    if (
      part.status === OrderPartStatus.REJECTED ||
      part.status === OrderPartStatus.STOCK_DEDUCTED
    ) {
      part.stockReserved = false;
    }
    await this.orderPartRepo.save(part);

    // A split refused by the admin does not re-allocate: the whole split was one
    // verdict, so the buyer is told and the order waits on their confirmation.
    // A single warehouse's rejection falls through to the normal derive, and the
    // offer-expiry sweep re-allocates it as before.
    if (
      part.status === OrderPartStatus.REJECTED &&
      (await this.routeSplitRejectionToBuyer(part.orderId))
    ) {
      return;
    }

    await this.refreshOrderStatus(part.orderId);

    // A consolidation the buyer chose earlier can only run once every warehouse
    // has prepared — which the part just advanced toward. Check, and start it.
    await this.maybeTriggerConsolidation(part.orderId);
  }

  /**
   * Starts a chosen consolidation the moment its LAST warehouse finishes
   * preparing. Enqueued onto the order module's own queue (which owns the truck
   * planning), keyed by order id so the many part events of one order do not
   * stack — the planner is idempotent behind that anyway.
   */
  private async maybeTriggerConsolidation(orderId: string): Promise<void> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order?.consolidate) return;
    if (order.fulfilmentMode === FulfilmentMode.DELIVERY) return;

    const parts = await this.orderPartRepo.find({ where: { orderId } });
    const live = parts.filter(
      (p) =>
        !FAILED_PART_STATUSES.includes(p.status) &&
        p.status !== OrderPartStatus.CANCELLED,
    );
    // Nothing to gather from one warehouse, and not ready until every part is.
    if (live.length < 2) return;
    if (!live.every((p) => p.status === OrderPartStatus.IN_OUTPUT_ZONE)) return;

    await this.orderTasks.add(
      ORDER_TASKS.PLAN_CONSOLIDATION,
      { orderId },
      {
        jobId: `plan-consolidation-${orderId}`,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  /**
   * If the order was split in its latest round, moves it to
   * REJECTED_AWAITING_BUYER and tells the buyer — and returns true so the caller
   * skips the ordinary re-allocation path. Returns false for a single-warehouse
   * order, which re-allocates as before.
   *
   * Sticky and idempotent: a split's parts are all rejected in Odoo at once and
   * report back one by one, so the FIRST report moves the order and the rest
   * find it already there (or already terminal) and change nothing.
   */
  private async routeSplitRejectionToBuyer(orderId: string): Promise<boolean> {
    if (!(await this.wasSplitInLatestRound(orderId))) return false;

    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) return false;
    if (order.status === OrderStatus.REJECTED_AWAITING_BUYER) return true;
    if (TERMINAL_ORDER_STATUSES.includes(order.status)) return true;
    if (!canTransition(order.status, OrderStatus.REJECTED_AWAITING_BUYER)) {
      // Already moved on some other path — leave it be, but still owned here.
      return true;
    }

    order.status = OrderStatus.REJECTED_AWAITING_BUYER;
    await this.orderRepo.save(order);
    winstonLogger.info(
      `Order ${order.orderNumber}: split refused by the administrator — awaiting the buyer's confirmation`,
      LOG_META,
    );
    await this.notifySplitRejected(order);
    return true;
  }

  /**
   * A split was one allocation to several warehouses. The decision lives in the
   * pure helper; this only reads the round ledger for the order.
   */
  private async wasSplitInLatestRound(orderId: string): Promise<boolean> {
    const offers = await this.orderPartOfferRepo.find({ where: { orderId } });
    return latestRoundWasSplit(offers);
  }

  /**
   * The admin re-routed a split part to another warehouse in Odoo, which owns
   * the reservation. Here the backend catches up: re-point the part, read the
   * new leg's distance from the cache, re-price its delivery, and refresh the
   * order's totals.
   *
   * Only a part still OFFERED can be reassigned (Odoo enforces the same, on the
   * pending state) — a later event for one already moving is stale and ignored.
   */
  private async applyReassignment(
    part: OrderPart,
    payload: OrderEventPayload,
  ): Promise<void> {
    if (!payload.warehouseOdooId) return;
    if (part.status !== OrderPartStatus.OFFERED) {
      winstonLogger.warn(
        `Ignoring reassignment of part ${part.id}: it is already ${part.status}`,
        LOG_META,
      );
      return;
    }

    const warehouse = await this.warehouseRepo.findOne({
      where: { odooWarehouseId: payload.warehouseOdooId },
    });
    if (!warehouse) {
      winstonLogger.warn(
        `Reassignment names Odoo warehouse ${payload.warehouseOdooId}, which has no mirror here`,
        LOG_META,
      );
      return;
    }
    if (warehouse.id === part.warehouseId) return; // already there

    const order = part.order;
    const from = part.warehouseId;
    part.warehouseId = warehouse.id;

    // Distance to the new warehouse from the cache (buyer↔warehouse pairs are
    // pre-measured); leave the old figure if this pair is not cached yet — the
    // warm-up/refresh fills it and delivery re-prices then.
    const cached = await this.distanceCacheRepo.findOne({
      where: { buyerProfileId: order.buyerProfileId, warehouseId: warehouse.id },
    });
    if (cached) part.distanceKm = String(cached.distanceKm);

    // Re-price the delivery leg for the new warehouse at the backend-admin rate
    // (the same one allocation and the trip use); a collection order has no leg,
    // so its cost stays zero.
    if (order.fulfilmentMode === FulfilmentMode.DELIVERY) {
      const quote = await this.rates.quote(Number(part.distanceKm));
      part.deliveryCost = String(quote.cost);
    }
    await this.orderPartRepo.save(part);

    await this.recalculateOrderTotals(order.id);
    winstonLogger.info(
      `Order ${order.orderNumber}: part ${part.id} reassigned ${from} -> ${warehouse.id}`,
      LOG_META,
    );
  }

  /**
   * Re-sums an order's delivery from its live parts after one was reassigned.
   * Goods are unchanged — the same lines at the same frozen prices — so only the
   * delivery leg and the grand total can move.
   */
  private async recalculateOrderTotals(orderId: string): Promise<void> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) return;
    const parts = await this.orderPartRepo.find({ where: { orderId } });
    const live = parts.filter(
      (p) =>
        p.status !== OrderPartStatus.REJECTED &&
        p.status !== OrderPartStatus.EXPIRED &&
        p.status !== OrderPartStatus.CANCELLED,
    );
    const delivery = live.reduce((sum, p) => sum + Number(p.deliveryCost), 0);
    order.deliveryTotal = String(round3(delivery));
    order.grandTotal = String(round3(Number(order.goodsTotal) + delivery));
    await this.orderRepo.save(order);
  }

  /** Tell the buyer their split order could not be fulfilled. */
  private async notifySplitRejected(order: Order): Promise<void> {
    try {
      const n = await this.notifications.createNotification({
        userId: order.buyerAccountId,
        title: 'Your order could not be fulfilled',
        body: `Order ${order.orderNumber} could not be fulfilled and was declined. Confirm to close it.`,
        titleKey: 'notifications.orderSplitRejected.title',
        bodyKey: 'notifications.orderSplitRejected.body',
        args: { order: order.orderNumber },
        type: NotificationType.ODOO,
      });
      await this.notifications.enqueueNotification(n.id);
    } catch (error) {
      winstonLogger.warn(
        `Failed to notify buyer of split rejection: ${(error as Error).message}`,
        LOG_META,
      );
    }
  }

  /**
   * Recomputes the buyer-facing status from every part. Derived rather than
   * set, because a split order that moved on while one warehouse was still
   * working would be telling the buyer something they could act on and be
   * wrong about.
   */
  private async refreshOrderStatus(orderId: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) return;
    const parts = await this.orderPartRepo.find({ where: { orderId } });

    const derived = deriveOrderStatus(order.fulfilmentMode, parts);
    if (!derived || derived === order.status) return;
    if (!canTransition(order.status, derived)) return;

    order.status = derived;
    const now = new Date();
    if (derived === OrderStatus.PREPARING) order.preparingAt = now;
    if (derived === OrderStatus.DELIVERED) order.deliveredAt = now;
    await this.orderRepo.save(order);
    winstonLogger.info(
      `Order ${order.orderNumber} is now ${derived}`,
      LOG_META,
    );
  }

  private stampPart(part: OrderPart, status: OrderPartStatus): void {
    const now = new Date();
    const stamps: Partial<Record<OrderPartStatus, () => void>> = {
      [OrderPartStatus.STOCK_DEDUCTED]: () => (part.stockDeductedAt = now),
      [OrderPartStatus.IN_OUTPUT_ZONE]: () => (part.finishedAt = now),
      [OrderPartStatus.DISPATCHED]: () => (part.dispatchedAt = now),
      [OrderPartStatus.DELIVERED]: () => (part.deliveredAt = now),
    };
    stamps[status]?.();
  }

  // --- Delivery tariffs (Odoo → backend) -------------------------------------
  /**
   * Rebuilds the delivery-pricing mirror from Odoo, which authors it.
   *
   * A full replace, not a diff: the table is tiny, and replacing it means a
   * tariff the admin DELETED in Odoo actually disappears here — a diff would
   * leave it behind and keep quoting a price that no longer exists.
   */
  private async syncDeliveryTariffs() {
    const rows = (await this.odoo.fetchDeliveryTariffs()) ?? [];
    if (!rows.length) return;

    // Resolve Odoo warehouse ids to backend ids in ONE query rather than one
    // lookup per row.
    const odooWarehouseIds = rows
      .map((r) => r.odoo_warehouse_id)
      .filter((id): id is number => typeof id === 'number');
    const warehouses = odooWarehouseIds.length
      ? await this.warehouseRepo.find({
          where: { odooWarehouseId: In(odooWarehouseIds) },
        })
      : [];
    const warehouseByOdooId = new Map(
      warehouses.map((w) => [w.odooWarehouseId as number, w.id]),
    );

    const keptIds: string[] = [];
    for (const row of rows) {
      const scope = tariffScopeFromOdoo(row.scope);
      if (!scope) continue; // unknown scope: skip rather than mis-price

      let tariff = await this.tariffRepo.findOne({
        where: { odooTariffId: row.odoo_id },
      });
      if (!tariff) {
        tariff = this.tariffRepo.create({ odooTariffId: row.odoo_id });
      }
      tariff.scope = scope;
      tariff.warehouseId =
        warehouseByOdooId.get(row.odoo_warehouse_id) ?? undefined;
      // Odoo sends the backend's OWN province uuid (a related field on the
      // tariff's province), so this links directly with no name matching.
      tariff.provinceId = row.province_backend_id ?? undefined;
      tariff.baseFee = String(row.base_fee ?? 0);
      tariff.ratePerKm = String(row.rate_per_km ?? 0);
      tariff.minFee = String(row.min_fee ?? 0);
      tariff.currency = row.currency || 'SYP';
      tariff.isActive = row.active !== false;
      tariff.syncedAt = new Date();
      const saved = await this.tariffRepo.save(tariff);
      keptIds.push(saved.id);
    }

    // Anything Odoo no longer reports was deleted there.
    const stale = await this.tariffRepo.find();
    const removed = stale.filter((t) => !keptIds.includes(t.id));
    for (const t of removed) await this.tariffRepo.delete(t.id);

    winstonLogger.info(
      `Delivery tariffs mirrored: ${keptIds.length} kept, ${removed.length} removed`,
      LOG_META,
    );
  }

  // --- Governorates (backend → Odoo) -----------------------------------------
  /**
   * Mirrors one governorate into Odoo, where warehouses link to it instead of
   * to a hard-coded Selection. Keyed by the backend uuid on the Odoo side, so
   * a rename updates the same row and never spawns a second 'Damascus'.
   */
  private async syncProvince(payload: SyncProvincePayload) {
    const province = await this.provinceRepo.findOne({
      where: { id: payload.provinceId },
    });
    if (!province) return;
    await this.odoo.upsertProvince({
      id: province.id,
      name_en: province.name_en,
      name_ar: province.name_ar,
    });
  }

  /**
   * The admin deleted a governorate here. Odoo ARCHIVES its copy rather than
   * unlinking it: warehouses created while it existed still point at it, and
   * that history has to survive the delete.
   */
  private async deleteProvince(payload: DeleteProvincePayload) {
    await this.odoo.archiveProvince(payload.backendProvinceId);
  }

  /**
   * Full governorate re-push (startup + reconcile cron). A single push can be
   * lost while Odoo is down; this replays the whole list, so the mirror
   * converges without anyone re-saving each row by hand.
   */
  private async syncAllProvinces() {
    const provinces = await this.provinceRepo.find();
    const result = await this.odoo.syncAllProvinces(
      provinces.map((p) => ({
        id: p.id,
        name_en: p.name_en,
        name_ar: p.name_ar,
      })),
    );
    winstonLogger.info(
      `Governorate sync: ${result?.synced ?? provinces.length} mirrored, ` +
        `${result?.archived ?? 0} archived in Odoo`,
      LOG_META,
    );
  }

  // --- Warehouse info + inventory (Odoo → backend) ----------------------------
  /**
   * Mirrors one warehouse FROM Odoo: master data (name/code — Odoo-side edits
   * win) and then the stock lines. Triggered by the admin sync endpoint and by
   * the Odoo webhooks, so any change in Odoo lands here within seconds.
   */
  /**
   * Mirror the manager Odoo assigned to a warehouse into `warehouse_managers`.
   *
   * Odoo owns this assignment — its admin dashboard has the "Change Manager"
   * action and the backend deliberately has none — so the row here is a copy,
   * matched on `odooUserId` rather than on email: an admin correcting a typo in
   * someone's address must not create a second manager.
   *
   * A REMOVED assignment is mirrored too. Leaving the old row behind would be
   * the worse failure of the two: the API would keep naming someone who is no
   * longer responsible for the site, which reads as fact rather than as stale
   * data.
   *
   * Failures are logged, not thrown: the caller's real work is the stock sync,
   * and losing a whole inventory refresh because a manager lookup timed out
   * would trade a small staleness for a large one.
   */
  private async mirrorWarehouseManager(warehouse: Warehouse): Promise<void> {
    try {
      const odooManager = await this.odoo.fetchWarehouseManager(
        warehouse.odooWarehouseId,
      );

      const existing = await this.warehouseManagerRepo.findOne({
        where: { warehouse: { id: warehouse.id } },
        relations: ['warehouse'],
      });

      if (!odooManager) {
        if (existing) {
          await this.warehouseManagerRepo.remove(existing);
          winstonLogger.info(
            `Warehouse ${warehouse.name} has no manager in Odoo — the mirrored one was dropped`,
            LOG_META,
          );
        }
        return;
      }

      // Matched on the Odoo user id, so the same person moving between
      // warehouses updates one row instead of accumulating them.
      let manager =
        (await this.warehouseManagerRepo.findOne({
          where: { odooUserId: odooManager.id },
        })) ?? this.warehouseManagerRepo.create({ odooUserId: odooManager.id });

      manager.fullName = odooManager.name ?? manager.fullName ?? '';
      manager.email = odooManager.email || odooManager.login || manager.email;
      manager.phone = odooManager.phone || manager.phone || '';
      manager.warehouse = warehouse;
      await this.warehouseManagerRepo.save(manager);

      // The previous holder, if somebody else now has the job.
      if (existing && existing.id !== manager.id) {
        await this.warehouseManagerRepo.remove(existing);
      }
    } catch (error) {
      winstonLogger.warn(
        `Could not mirror the manager of warehouse ${warehouse.name}: ${
          (error as Error)?.message ?? error
        }`,
        LOG_META,
      );
    }
  }

  /**
   * Re-read every warehouse Odoo has, adopting the ones it created itself.
   *
   * The reconciliation layer. A per-warehouse announcement is fire-and-forget:
   * if this backend was down when it was sent, or the call failed past its
   * retries, nothing would ever send it again. This sweep converges on whatever
   * was missed — a create, a rename, a closure — without an outbox table or any
   * change tracking, because it simply asks Odoo what is true now.
   *
   * Each warehouse goes through the SAME per-warehouse sync a ping triggers, so
   * there is one description of "copy a warehouse out of Odoo" rather than a
   * second one here that drifts from it.
   *
   * One failure does not abort the sweep: a single warehouse Odoo cannot read
   * must not stop the other twenty from being corrected.
   */
  private async syncAllWarehouses() {
    const odooWarehouses = await this.odoo.fetchWarehouses();
    let refreshed = 0;
    let adopted = 0;

    for (const ow of odooWarehouses) {
      try {
        const existing = await this.warehouseRepo.findOne({
          where: { odooWarehouseId: ow.id },
        });
        if (!existing) adopted++;
        else refreshed++;
        await this.syncWarehouse({
          warehouseId: existing?.id,
          odooWarehouseId: ow.id,
          jobId: `reconcile-${ow.id}`,
        });
      } catch (err) {
        winstonLogger.warn(
          `Warehouse reconcile: ${ow.name ?? ow.id} could not be synced — ${(err as Error).message}`,
          LOG_META,
        );
      }
    }

    winstonLogger.info(
      `Warehouse reconcile: ${refreshed} refreshed, ${adopted} adopted from Odoo`,
      LOG_META,
    );
    return { refreshed, adopted };
  }

  /**
   * A warehouse that was created in ODOO and has no mirror here yet.
   *
   * The backend used to assume it was the only place warehouses are created, so
   * an announcement carrying an id it did not recognise was answered with a 404
   * and thrown away. That stopped being true the moment the Odoo dashboard grew
   * a "create warehouse" button: the site existed there, held stock and took
   * shipments, and was simply absent from every backend listing — and no amount
   * of re-announcing would ever have added it.
   *
   * Only the SKELETON is created here. Everything else — name, code,
   * governorate, coordinates, capacity, address, lifecycle, manager, stock — is
   * filled in by the very sync that called this, so there is ONE piece of code
   * that knows how to copy a warehouse out of Odoo rather than a second one
   * that drifts from it.
   *
   * Returns null rather than throwing when the id is not in Odoo either: that
   * is a stale announcement, not a fault, and failing the job would retry it
   * forever.
   */
  private async adoptOdooWarehouse(odooWarehouseId?: number) {
    if (odooWarehouseId == null) return null;

    const existing = await this.warehouseRepo.findOne({
      where: { odooWarehouseId },
    });
    if (existing) return existing;

    const info = await this.odoo.fetchWarehouseInfo(odooWarehouseId);
    if (!info) {
      winstonLogger.warn(
        `Odoo announced warehouse ${odooWarehouseId}, which Odoo itself does not have — ignored`,
        LOG_META,
      );
      return null;
    }

    const adopted = await this.warehouseRepo.save(
      this.warehouseRepo.create({
        odooWarehouseId,
        name: info.name,
        // A placeholder only if Odoo somehow has none: the column is unique and
        // NOT NULL here, and refusing the whole adoption over a missing code
        // would keep a real warehouse invisible over a cosmetic field.
        code: info.code || `ODOO-${odooWarehouseId}`,
        // `state` defaults to ACTIVE and is then set from Odoo's own state below
        // / on the next sync — the removed `isActive` flag was redundant with it.
        odooSyncStatus: OdooSyncStatus.SYNCED,
      }),
    );
    winstonLogger.info(
      `Adopted warehouse "${adopted.name}" created in Odoo (${odooWarehouseId})`,
      LOG_META,
    );
    return adopted;
  }

  private async syncWarehouse(payload: SyncWarehousePayload) {
    const warehouse = payload.warehouseId
      ? await this.warehouseRepo.findOne({ where: { id: payload.warehouseId } })
      : await this.adoptOdooWarehouse(payload.odooWarehouseId);
    if (!warehouse) return;

    // 1) Warehouse master data (Odoo is the editing surface after creation).
    const info = await this.odoo.fetchWarehouseInfo(warehouse.odooWarehouseId);
    if (info) {
      if (info.name) warehouse.name = info.name;
      if (info.code) warehouse.code = info.code;
      if (info.governorate) warehouse.governorate = info.governorate;
      // A warehouse that MOVED invalidates every cached distance to it: those
      // rows price deliveries per kilometre, so keeping them would charge
      // buyers for a journey to where the warehouse used to be.
      const moved =
        (info.latitude != null && String(info.latitude) !== warehouse.latitude) ||
        (info.longitude != null && String(info.longitude) !== warehouse.longitude);
      if (info.latitude != null) warehouse.latitude = String(info.latitude);
      if (info.longitude != null) warehouse.longitude = String(info.longitude);
      if (moved) {
        await this.distanceCacheRepo.delete({ warehouseId: warehouse.id });
        winstonLogger.info(
          `Warehouse ${warehouse.name} moved — cached distances to it were dropped`,
          LOG_META,
        );
      }
      // Lifecycle comes from Odoo, which owns closing/reopening. Order
      // allocation reads it, so a warehouse put into `closing` there stops
      // receiving new orders here within one sync.
      // Capacity and address are edited in Odoo and were never read back, so
      // the backend kept whatever it was created with. Capacity is the worse
      // of the two: load is reported as a percentage of it, so the two systems
      // showed different fullness for the same building.
      if (info.capacity != null && info.capacity !== false) {
        warehouse.capacity = Number(info.capacity) || undefined;
      }
      if (info.address) warehouse.address = info.address;
      if (info.shipment_count != null && info.shipment_count !== false) {
        warehouse.shipmentCount = Number(info.shipment_count) || 0;
      }
      warehouse.state = warehouseStateFromOdoo(info.state);
      // The province link travels as the backend's OWN uuid (a related field on
      // recycle.warehouse), so this is a direct assignment — no name matching.
      warehouse.provinceId = info.province_backend_id || warehouse.provinceId;
    }

    // 1b) The manager Odoo assigned to this warehouse.
    //
    //     This was missing, and it is why `GET /admin/warehouses` reported
    //     `manager: null` for a warehouse that visibly HAS one in Odoo. The
    //     read APIs join the relation correctly — there was simply no row in
    //     `warehouse_managers` to join to, because nothing but two manual
    //     admin routes (`:id/sync-manager`, `import-from-odoo`) ever wrote one.
    //     So the manager appeared only after somebody remembered to call a
    //     sync by hand, which is not a synchronisation — it is a chore.
    await this.mirrorWarehouseManager(warehouse);

    // 2) Stock lines — one mirror row per (product, condition). The sorter in
    //    Odoo grades every processed quantity, so lines carry condition_code;
    //    unsorted stock arrives without one and lands under UNGRADED.
    const lines = await this.odoo.fetchWarehouseInventory(warehouse.odooWarehouseId);

    // Odoo keeps ONE stock row per (product, condition, STORAGE ZONE), so the
    // same grade of the same material appears several times — once per zone.
    // The mirror is zone-agnostic (the backend never picks zones; the output
    // employee does, inside Odoo), so the rows are SUMMED first. Writing them
    // one by one would let the last zone overwrite the others and the mirror
    // would report a fraction of the real stock.
    const totals = new Map<string, InventoryTotal>();
    for (const line of lines) {
      const odooProductId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
      if (!odooProductId) continue;
      const productName = Array.isArray(line.product_id) ? line.product_id[1] : undefined;
      // The Odoo field is `condition` (recycle.stock). Unsorted stock has none
      // and lands under UNGRADED.
      const conditionCode =
        typeof line.condition === 'string' && line.condition
          ? line.condition.toUpperCase()
          : UNGRADED_CONDITION;

      const key = `${odooProductId}|${conditionCode}`;
      const acc = totals.get(key) ?? {
        odooProductId,
        conditionCode,
        productName,
        quantity: 0,
        reserved: 0,
      };
      acc.productName = acc.productName ?? productName;
      acc.quantity += Number(line.quantity ?? 0);
      acc.reserved += Number(line.reserved_qty ?? 0);
      totals.set(key, acc);
    }

    const seenRowIds = new Set<string>();
    for (const acc of totals.values()) {
      let row = await this.inventoryRepo.findOne({
        where: {
          warehouseId: warehouse.id,
          odooProductId: acc.odooProductId,
          conditionCode: acc.conditionCode,
        },
      });
      if (!row) {
        row = this.inventoryRepo.create({
          warehouseId: warehouse.id,
          odooProductId: acc.odooProductId,
          conditionCode: acc.conditionCode,
        });
      }
      row.productName = acc.productName ?? row.productName;
      row.quantity = String(acc.quantity);
      row.reservedQuantity = String(acc.reserved);
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
    const seenShiftOdooIds = new Set<number>();
    for (const os of odooShifts) {
      seenShiftOdooIds.add(os.id);
      let shift =
        (await this.shiftRepo.findOne({ where: { odooShiftId: os.id } })) ??
        (await this.shiftRepo.findOne({ where: { name: os.name } }));
      if (!shift) shift = this.shiftRepo.create({ name: os.name });
      shift.odooShiftId = os.id;
      shift.name = os.name ?? shift.name;
      const start = odooFloatToTime(os.start_time);
      const end = odooFloatToTime(os.end_time);
      if (start) shift.startTime = start;
      if (end) shift.endTime = end;
      // Scope mirror. A GLOBAL shift applies to every warehouse (and is the
      // only kind an unaccepted driver can pick during onboarding). A SPECIFIC
      // shift lists its warehouses; drivers may only request changes into a
      // shift that is global OR that includes their own warehouse.
      shift.isGlobal = !!os.is_global;
      shift.odooWarehouseIds = os.is_global
        ? []
        : (Array.isArray(os.warehouse_ids) ? os.warehouse_ids : []);
      // Keep the deprecated single column roughly meaningful for any legacy
      // reader: the first warehouse, or null when global / unset.
      shift.odooWarehouseId = shift.odooWarehouseIds.length
        ? shift.odooWarehouseIds[0]
        : null;
      // Grace margin (minutes) — the handover crons use it as the pickup/
      // dropoff tolerance.
      shift.tolerance = Number.isFinite(os.tolerance) ? os.tolerance : 0;
      // Audience mirrors Odoo: only DRIVER shifts reach the driver app.
      shift.shiftType = os.shift_type === 'warehouse' ? ShiftType.WAREHOUSE : ShiftType.DRIVER;
      shift.isActive = true;
      await this.shiftRepo.save(shift);
    }

    // 2) Trucks (linked to their warehouse via odooWarehouseId).
    // The backend admin is told about fleet authoring done in Odoo: a new
    // truck, or an existing truck (re/un)assigned to a warehouse.
    //
    // ONLY COLLECTION trucks are mirrored. Delivery trucks are Odoo's to manage
    // — they are driven by delivery drivers who have no backend account, and the
    // delivery-trip planner reads them LIVE from Odoo at plan time — so keeping a
    // stale local copy would only be a second source of truth to drift. Delivery
    // trucks are skipped below, and any that a previous sync had already mirrored
    // are purged afterwards.
    const odooTrucks = await this.odoo.fetchTrucks();
    for (const ot of odooTrucks) {
      // A delivery truck is not the backend's to store: skip it entirely, so it
      // is neither upserted nor announced to the backend admin.
      if (truckTypeFromOdoo(ot.truck_type) === TruckType.DELIVERY) continue;

      const warehouseOdooId = Array.isArray(ot.warehouse_id) ? ot.warehouse_id[0] : ot.warehouse_id;
      const warehouse = warehouseOdooId
        ? await this.warehouseRepo.findOne({ where: { odooWarehouseId: warehouseOdooId } })
        : null;

      let truck = await this.truckRepo.findOne({ where: { odooTruckId: ot.id } });
      const isNew = !truck;
      const prevWarehouseId = truck?.warehouseId ?? null;
      if (!truck) truck = this.truckRepo.create({ odooTruckId: ot.id, status: TruckStatus.ACTIVE });
      truck.truckType = truckTypeFromOdoo(ot.truck_type);
      truck.model = ot.model ?? truck.model ?? '';
      truck.year = ot.year ?? truck.year ?? 0;
      truck.plateNumber = ot.plate_number ?? truck.plateNumber;
      truck.maxPayloadKg = ot.max_payload_kg ?? truck.maxPayloadKg;
      // Bed dimensions mirror Odoo. Odoo returns 0.0 for an unset Float, which
      // is a real "not recorded" here, so a 0 is stored as null to keep the
      // backend row honest rather than claiming a zero-length truck.
      truck.lengthM = ot.length_m ? Number(ot.length_m) : null;
      truck.widthM = ot.width_m ? Number(ot.width_m) : null;
      truck.warehouseId = warehouse?.id ?? null;
      if (ot.is_active === false) truck.status = TruckStatus.DISABLED;
      else if (truck.status === TruckStatus.DISABLED) truck.status = TruckStatus.ACTIVE;
      await this.truckRepo.save(truck);

      const plate = truck.plateNumber ?? '';
      if (isNew) {
        if (warehouse) {
          await this.notifyAdmins({
            title: 'New truck added',
            body: `Truck "${plate}" was added in Odoo and assigned to warehouse "${warehouse.name}".`,
            titleKey: 'notifications.truckAdded.title',
            bodyKey: 'notifications.truckAdded.body',
            args: { plate, warehouse: warehouse.name },
          });
        } else {
          await this.notifyAdmins({
            title: 'New truck added',
            body: `Truck "${plate}" was added in Odoo (not assigned to a warehouse yet).`,
            titleKey: 'notifications.truckAddedUnassigned.title',
            bodyKey: 'notifications.truckAddedUnassigned.body',
            args: { plate },
          });
        }
      } else if (prevWarehouseId !== truck.warehouseId) {
        if (warehouse) {
          await this.notifyAdmins({
            title: 'Truck assignment changed',
            body: `Truck "${plate}" is now assigned to warehouse "${warehouse.name}".`,
            titleKey: 'notifications.truckAssignmentChanged.title',
            bodyKey: 'notifications.truckAssignmentChanged.body',
            args: { plate, warehouse: warehouse.name },
          });
        } else {
          await this.notifyAdmins({
            title: 'Truck assignment changed',
            body: `Truck "${plate}" is no longer assigned to any warehouse.`,
            titleKey: 'notifications.truckUnassigned.title',
            bodyKey: 'notifications.truckUnassigned.body',
            args: { plate },
          });
        }
      }
    }

    // 2b) Purge any DELIVERY trucks a previous sync mirrored, before the type
    // split existed. Delivery trucks belong to Odoo alone now; a leftover local
    // row would be stale the moment Odoo's admin touched it. Delivery trips are
    // keyed by the ODOO truck id (a number), not a FK to this table, so nothing
    // references these rows and the delete is safe.
    await this.truckRepo.delete({ truckType: TruckType.DELIVERY });

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

    // Shifts deleted in Odoo: drop the mirror row. When historical rows
    // (driver profiles, old requests) still reference it, the FK blocks the
    // delete — deactivate instead so it disappears from driver-facing lists.
    // Runs AFTER the assignment cleanup so freshly-removed assignments no
    // longer hold a reference.
    const mirroredShifts = await this.shiftRepo
      .createQueryBuilder('s')
      .where('s.odooShiftId IS NOT NULL')
      .getMany();
    for (const s of mirroredShifts) {
      if (seenShiftOdooIds.has(s.odooShiftId!)) continue;
      try {
        await this.shiftRepo.delete(s.id);
      } catch {
        if (s.isActive) {
          s.isActive = false;
          await this.shiftRepo.save(s);
          winstonLogger.warn(
            `Shift "${s.name}" was deleted in Odoo but is still referenced — deactivated instead`,
            LOG_META,
          );
        }
      }
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
    // `province` is joined so Odoo receives the province NAME (it has no
    // provinces table of its own — showing a raw uuid there would be useless).
    const profile = await this.collectorRepo.findOne({
      where: { account: { id: account.id } },
      relations: ['province'],
    });
    if (!profile) return;

    // The Odoo admin reviews the uploaded documents inline, so ship them
    // along (media id lets Odoo reject one specific image later).
    const media = await this.mediaRepo.find({
      where: { ownerId: profile.id, ownerType: OwnerType.COLLECTOR },
    });

    // The driver's shift travels with his info: he picked it during
    // onboarding (a mirror of an Odoo driver shift), so Odoo's assignment
    // screen can filter drivers by shift.
    const shift = profile.shiftId
      ? await this.shiftRepo.findOne({ where: { id: profile.shiftId } })
      : null;

    // PostGIS stores the point as { type:'Point', coordinates:[lng, lat] }.
    const coords = (profile as any).coordinates?.coordinates;
    const [longitude, latitude] = Array.isArray(coords) ? coords : [null, null];

    await this.odoo.createDriverRequest({
      backendDriverId: profile.id,
      name: account.name,
      email: account.email,
      phone: account.phone ?? null,
      nationalId: profile.NationalID ?? null,
      shiftOdooId: shift?.odooShiftId ?? null,
      // Prefer Arabic (the Odoo admin UI is Arabic-first), fall back to English.
      provinceName: profile.province?.name_ar || profile.province?.name_en || null,
      address: (profile as any).address ?? null,
      locationNote: (profile as any).DesscriptLocation ?? null,
      latitude: typeof latitude === 'number' ? latitude : null,
      longitude: typeof longitude === 'number' ? longitude : null,
      // The reviewer's verdict travels with each file. The push is an upsert
      // that replaces Odoo's whole image list, so sending files alone reset the
      // judgement on every document the driver had not touched.
      images: media.map((m) => ({
        mediaId: m.id,
        fileType: m.fileType,
        url: m.url,
        status: m.status,
        reuploadRequested: !!m.reuploadRequestedAt,
      })),
    });
  }

  /** Odoo admin decided on a driver request (and possibly assigned a truck). */
  private async applyDriverDecision(payload: DriverDecisionPayload) {
    const profile = await this.collectorRepo.findOne({
      where: { id: payload.backendDriverId },
      relations: ['account'],
    });
    if (!profile?.account) return;

    // Resolve the mirrored warehouse row when Odoo tells us which warehouse
    // the driver belongs to (on acceptance, or on an admin warehouse move).
    const warehouse = payload.warehouseOdooId
      ? await this.warehouseRepo.findOne({ where: { odooWarehouseId: payload.warehouseOdooId } })
      : null;

    // Pure warehouse move (admin relocated the driver in Odoo): update the
    // mirror only — no status change, no notification.
    if (payload.warehouseChangeOnly) {
      if (warehouse) {
        profile.warehouseId = warehouse.id;
        await this.collectorRepo.save(profile);
      }
      return;
    }

    // The reviewer marked a document unacceptable and NOTHING ELSE.
    //
    // Rejecting a document and telling the driver to replace it used to be one
    // act, so the reviewer could not mark the first of four documents bad
    // without ending the review and sending him off to start fixing. This
    // branch is the first half on its own: the mirror moves so his re-upload
    // route will accept the file later, and he is told nothing.
    if (payload.documentsOnly) {
      if (payload.rejectedMediaIds?.length) {
        await this.mediaRepo.update(
          { id: In(payload.rejectedMediaIds), ownerId: profile.id },
          { status: statusMedia.REJECTED },
        );
      }
      // ACCEPTING one travels the same way, and did not before: the reviewer
      // marked a document acceptable in Odoo and the mirror went on holding it
      // REJECTED. The driver could then still be asked to replace a file that
      // had already been taken, and the backend's approval gate went on
      // counting a rejection that no longer existed.
      //
      // Any outstanding request is closed with it — an accepted document is not
      // something he still owes.
      if (payload.approvedMediaIds?.length) {
        await this.mediaRepo.update(
          { id: In(payload.approvedMediaIds), ownerId: profile.id },
          {
            status: statusMedia.APPROVED,
            reuploadRequestedAt: null,
            reuploadReason: null,
          },
        );
      }
      return;
    }

    // Odoo controls the whole driver lifecycle: explicit status wins
    // (BLOCKED / NEED_CHANGES / ...); plain approved maps to ACTIVE/REJECTED.
    const newStatus =
      (payload.status as AccountStatus | undefined) ??
      (payload.approved ? AccountStatus.ACTIVE : AccountStatus.REJECTED);
    await this.accountRepo.update(profile.account.id, { accountStatus: newStatus });

    if (warehouse) {
      profile.warehouseId = warehouse.id;
      await this.collectorRepo.save(profile);
    }

    // A BLOCKED driver is thrown out immediately: wiping every device's
    // refresh + FCM token kills token renewal (his short-lived access token
    // simply expires), and the login strategy's BLOCKED handler refuses any
    // new sign-in until Odoo unblocks him.
    if (newStatus === AccountStatus.BLOCKED) {
      await this.userDeviceRepo.update(
        { accountId: profile.account.id },
        { refreshToken: '', fcmToken: '' },
      );
    }

    // Documents the Odoo admin flagged: mark them REJECTED so the driver's
    // re-upload endpoint (PATCH /media/:id/reupload) accepts exactly those.
    // Ownership is enforced — only this driver's media can be touched.
    //
    // `requestReupload` additionally records them as ASKED FOR. That record,
    // not the rejection, is what releases him back into the queue once he has
    // answered: a document rejected but never requested is one he was never
    // told about and cannot see, and counting it would hold him in
    // NEED_CHANGES for ever with nothing on his screen left to fix.
    if (payload.rejectedMediaIds?.length) {
      await this.mediaRepo.update(
        { id: In(payload.rejectedMediaIds), ownerId: profile.id },
        payload.cancelReupload
          ? // The reviewer gave up waiting. The request is withdrawn and the
            // status is deliberately left alone: a document they called
            // unacceptable stays unacceptable, so accepting the driver is still
            // blocked by it while rejecting him is now possible. Clearing the
            // status here would turn "I stopped waiting" into "I accept what
            // you sent", silently.
            { reuploadRequestedAt: null, reuploadReason: null }
          : {
              status: statusMedia.REJECTED,
              ...(payload.requestReupload
                ? {
                    reuploadRequestedAt: new Date(),
                    reuploadReason: payload.rejectionReason ?? null,
                  }
                : {}),
            },
      );
    }

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

    const statusMessages: Record<string, [string, string, string?, string?]> = {
      [AccountStatus.ACTIVE]: [
        'Driver request approved',
        'Your request has been approved. You will be assigned to a truck soon.',
        'notifications.driverApproved.title',
        'notifications.driverApproved.body',
      ],
      [AccountStatus.REJECTED]: ['Driver request rejected', `Your driver request was rejected. ${payload.rejectionReason ?? ''}`.trim()],
      [AccountStatus.BLOCKED]: ['Account blocked', `Your driver account has been blocked. ${payload.rejectionReason ?? ''}`.trim()],
      [AccountStatus.NEED_CHANGES]: ['Changes requested', `Please update your information. ${payload.rejectionReason ?? ''}`.trim()],
      // The admin re-opened a previously rejected application. Without this
      // entry the lookup fell through to the REJECTED message and told the
      // driver he was rejected — the exact opposite of what happened.
      [AccountStatus.PENDING_APPROVAL]: payload.cancelReupload
        ? // The driver is looking at a screen telling him to re-upload
          // something nobody is waiting for any more. Reusing the generic
          // "re-opened" wording would leave that demand standing.
          [
            'No documents needed from you',
            'The document request was withdrawn. Your application is under review again with what you already sent.',
          ]
        : [
            'Driver request re-opened',
            'Your driver request is under review again.',
          ],
    };
    const [title, body, titleKey, bodyKey] =
      statusMessages[newStatus] ?? statusMessages[AccountStatus.REJECTED];
    await this.notifyDriver(profile.account.id, title, body, titleKey, bodyKey);
  }

  // --- Shift-change requests (backend -> Odoo -> backend) ----------------------
  /**
   * Mirrors a driver's shift-change request to Odoo where his WAREHOUSE
   * MANAGER decides (pending → processing → accepted-with-a-truck/rejected).
   */
  private async pushShiftChange(payload: PushShiftChangePayload) {
    const request = await this.shiftChangeRepo.findOne({
      where: { id: payload.requestId },
      relations: ['driver', 'driver.account', 'driver.shift', 'driver.warehouse', 'shift'],
    });
    // Deleted before the job ran (driver cancelled a still-queued push).
    if (!request) return;

    const requestedShiftOdooId = request.shift?.odooShiftId;
    if (!requestedShiftOdooId) {
      winstonLogger.warn(
        `Shift-change ${request.id} not pushed: requested shift has no Odoo id`,
        LOG_META,
      );
      return;
    }

    const odooId = await this.odoo.createShiftChangeRequest({
      backendRequestId: request.id,
      backendDriverId: request.driverId,
      driverName: request.driver?.account?.name ?? '',
      requestedShiftOdooId,
      currentShiftOdooId: request.driver?.shift?.odooShiftId ?? null,
      reason: request.reason ?? '',
      warehouseOdooId: request.driver?.warehouse?.odooWarehouseId ?? null,
    });
    request.odooRequestId = odooId;
    await this.shiftChangeRepo.save(request);
  }

  /** Driver cancelled his still-PENDING request → remove the Odoo mirror too. */
  private async cancelShiftChange(payload: CancelShiftChangePayload) {
    await this.odoo.cancelShiftChangeRequest(payload.backendRequestId);
  }

  // --- Truck problems (backend -> Odoo, read-only there) -----------------------
  /** Mirrors a driver's truck-problem report for his warehouse manager to read. */
  private async pushTruckProblem(payload: PushTruckProblemPayload) {
    const problem = await this.truckProblemRepo.findOne({
      where: { id: payload.problemId },
      relations: ['driver', 'driver.account', 'driver.warehouse'],
    });
    if (!problem) return;

    // The truck he is currently on (if any) gives the manager context.
    const assignment = await this.assignmentRepo.findOne({
      where: { driverId: problem.driverId },
      relations: ['truck'],
    });

    const odooId = await this.odoo.createTruckProblem({
      backendProblemId: problem.id,
      backendDriverId: problem.driverId,
      driverName: problem.driver?.account?.name ?? '',
      reason: problem.reason,
      imageUrls: problem.images ?? [],
      truckOdooId: assignment?.truck?.odooTruckId ?? null,
      warehouseOdooId: problem.driver?.warehouse?.odooWarehouseId ?? null,
    });
    problem.odooProblemId = odooId;
    await this.truckProblemRepo.save(problem);
  }

  // --- Truck handovers (backend -> Odoo, manager reads "Driver Attendance") -----
  /** Mirrors a PICKUP: create the Odoo handover row. */
  private async pushHandoverPickup(payload: PushHandoverPayload) {
    const h = await this.handoverRepo.findOne({
      where: { id: payload.handoverId },
      relations: ['driver', 'driver.account', 'truck', 'shift', 'warehouse'],
    });
    if (!h || !h.pickedUpAt) return;

    const odooId = await this.odoo.createTruckHandover({
      backendHandoverId: h.id,
      backendDriverId: h.driverId,
      driverName: h.driver?.account?.name ?? '',
      truckOdooId: h.truck?.odooTruckId ?? null,
      shiftOdooId: h.shift?.odooShiftId ?? null,
      warehouseOdooId: h.warehouse?.odooWarehouseId ?? null,
      workDate: h.workDate,
      pickedUpAt: this.odooDatetime(h.pickedUpAt),
    });
    h.odooHandoverId = odooId;
    await this.handoverRepo.save(h);
  }

  /** Mirrors a DROPOFF: close the Odoo handover row (idempotent by backend id). */
  private async pushHandoverDropoff(payload: PushHandoverPayload) {
    const h = await this.handoverRepo.findOne({ where: { id: payload.handoverId } });
    if (!h || !h.droppedOffAt) return;
    await this.odoo.closeTruckHandover({
      backendHandoverId: h.id,
      droppedOffAt: this.odooDatetime(h.droppedOffAt),
      dropoffReason: h.dropoffReason ?? null,
      lateMinutes: h.lateDropoffMinutes ?? 0,
    });
  }

  /**
   * Registers a delivered collection request's ACTUAL intake in Odoo. The job
   * carries everything (the processor owns no collection repos, and the payload
   * already has the Odoo ids resolved) — idempotent on the request id.
   */
  private async pushRegisterIntake(payload: RegisterIntakePayload) {
    await this.odoo.registerIntake({
      request_id: payload.requestId,
      warehouse_odoo_id: payload.odooWarehouseId ?? null,
      producer_name: payload.producerName ?? null,
      received_at: payload.receivedAt ?? null,
      lines: payload.lines.map((l) => ({
        product_odoo_id: l.odooProductId ?? null,
        quantity: l.quantity,
      })),
    });
  }

  /** Odoo stores naive UTC datetimes as 'YYYY-MM-DD HH:MM:SS'. */
  private odooDatetime(d: Date): string {
    return new Date(d).toISOString().slice(0, 19).replace('T', ' ');
  }

  /**
   * Applies the warehouse manager's move (made in Odoo) on a shift-change
   * request. PENDING → PROCESSING → ACCEPTED (he reserved a truck of the
   * requested shift) or REJECTED with a reason. Terminal states never change.
   */
  private async applyShiftChangeDecision(payload: ShiftChangeDecisionPayload) {
    const request = await this.shiftChangeRepo.findOne({
      where: { id: payload.requestId },
      relations: ['driver', 'driver.account', 'shift'],
    });
    if (!request) return;
    const terminal = [ShiftChangeRequestStatus.ACCEPTED, ShiftChangeRequestStatus.REJECTED];
    if (terminal.includes(request.status)) return;

    if (payload.status === 'PROCESSING') {
      if (request.status === ShiftChangeRequestStatus.PENDING) {
        request.status = ShiftChangeRequestStatus.PROCESSING;
        await this.shiftChangeRepo.save(request);
      }
      return;
    }

    if (payload.status === 'REJECTED') {
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

    // ACCEPTED: the manager reserved this truck for the driver's NEW shift.
    // Odoo (fleet master) already created its own assignment row and pinged
    // SYNC_FLEET — the moves below make the mirror consistent immediately
    // instead of waiting for that job.
    const truck = payload.truckOdooId
      ? await this.truckRepo.findOne({ where: { odooTruckId: payload.truckOdooId } })
      : null;
    if (!truck) {
      winstonLogger.warn(
        `Shift-change ${request.id} accepted without a known truck (odoo id ${payload.truckOdooId}) — waiting for SYNC_FLEET`,
        LOG_META,
      );
    } else {
      let row = await this.assignmentRepo.findOne({ where: { driverId: request.driverId } });
      if (!row) row = this.assignmentRepo.create({ driverId: request.driverId, assignedAt: new Date() });
      row.truckId = truck.id;
      row.shiftId = request.shiftId;
      await this.assignmentRepo.save(row);
      request.truckId = truck.id;
    }

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
        `Your shift and truck were changed; you are now on shift "${request.shift?.name ?? ''}" with truck "${truck?.plateNumber ?? ''}".`,
        'notifications.shiftChangeAccepted.title',
        'notifications.shiftChangeAccepted.body',
        { plate: truck?.plateNumber ?? '-', shift: request.shift?.name ?? '-' },
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

    // Any of the four catalogue branches above may have DELETED a category /
    // product / unit / condition (compensation for a create that never reached
    // Odoo) or flipped its sync status — a change the cached catalogue must not
    // keep serving. Drop the catalogue cache whenever the failed job was a
    // catalogue one, exactly as the admin CRUD and the reverse-sync do.
    if (
      job.name === ODOO_JOBS.SYNC_CATEGORY ||
      job.name === ODOO_JOBS.SYNC_PRODUCT ||
      job.name === ODOO_JOBS.SYNC_UNIT ||
      job.name === ODOO_JOBS.SYNC_CONDITION
    ) {
      await this.cache.invalidate('categories', 'products', 'offers');
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

/** Money is stored with 3 decimals across this project; keep totals aligned. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
