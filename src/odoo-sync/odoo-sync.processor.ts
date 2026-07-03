import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { OdooService } from '@src/odoo/odoo.service';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { ProductPricing } from '@src/waste-management/entities/product-pricing.entity';
import { OdooSyncStatus } from '@src/waste-management/enums/odoo-sync-status.enum';
import { PricingTier } from '@src/waste-management/enums/pricing-tier.enum';
import { Account } from '@src/user/entities/account.entity';
import { Role } from '@src/user/enums/role.enum';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import {
  CreateWarehousePayload,
  DeleteCategoryPayload,
  DeleteProductPayload,
  ODOO_JOBS,
  ODOO_SYNC_QUEUE,
  SyncCategoryPayload,
  SyncProductPayload,
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
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    try {
      switch (job.name) {
        case ODOO_JOBS.SYNC_CATEGORY:
          return await this.syncCategory(job.data as SyncCategoryPayload);
        case ODOO_JOBS.DELETE_CATEGORY:
          return await this.deleteCategory(job.data as DeleteCategoryPayload);
        case ODOO_JOBS.SYNC_PRODUCT:
          return await this.syncProduct(job.data as SyncProductPayload);
        case ODOO_JOBS.DELETE_PRODUCT:
          return await this.deleteProduct(job.data as DeleteProductPayload);
        case ODOO_JOBS.UPDATE_PRICING:
          return await this.updatePricing(job.data as UpdatePricingPayload);
        case ODOO_JOBS.CREATE_WAREHOUSE:
          return await this.createWarehouse(job.data as CreateWarehousePayload);
        case ODOO_JOBS.SYNC_WAREHOUSE:
          return await this.syncWarehouse(job.data as SyncWarehousePayload);
        default:
          winstonLogger.warn(`Unknown Odoo job: ${job.name}`, LOG_META);
          return null;
      }
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

  private async pushTierPrices(product: Product): Promise<void> {
    if (!product.odooProductId) return;

    const [factory, freeFacility] = await Promise.all([
      this.currentTierPrice(product.id, PricingTier.FACTORY),
      this.currentTierPrice(product.id, PricingTier.FREE_FACILITY),
    ]);

    const values: Record<string, number> = {};
    if (factory != null) values.price_factory = factory;
    if (freeFacility != null) values.price_free_facility = freeFacility;

    if (Object.keys(values).length > 0) {
      await this.odoo.updateProduct(product.odooProductId, values);
    }
  }

  /** Current effective price of a product for a given tier (or null). */
  private async currentTierPrice(productId: string, tier: PricingTier): Promise<number | null> {
    const row = await this.pricingRepo
      .createQueryBuilder('pp')
      .where('pp.productId = :productId', { productId })
      .andWhere('pp.tier = :tier', { tier })
      .andWhere('pp.effectiveFrom <= NOW()')
      .andWhere('(pp.effectiveUntil IS NULL OR pp.effectiveUntil > NOW())')
      .orderBy('pp.effectiveFrom', 'DESC')
      .getOne();
    return row ? Number(row.price) : null;
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
      zones: warehouse.zones ?? undefined,
    });

    warehouse.odooWarehouseId = odooId;
    warehouse.odooSyncStatus = OdooSyncStatus.SYNCED;
    warehouse.lastOdooSync = new Date();
    await this.warehouseRepo.save(warehouse);
  }

  // --- Warehouse inventory --------------------------------------------------
  private async syncWarehouse(payload: SyncWarehousePayload) {
    const warehouse = await this.warehouseRepo.findOne({ where: { id: payload.warehouseId } });
    if (!warehouse) return;

    const lines = await this.odoo.fetchWarehouseInventory(warehouse.odooWarehouseId);

    for (const line of lines) {
      const odooProductId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
      const productName = Array.isArray(line.product_id) ? line.product_id[1] : undefined;

      let row = await this.inventoryRepo.findOne({
        where: { warehouseId: warehouse.id, odooProductId },
      });
      if (!row) {
        row = this.inventoryRepo.create({ warehouseId: warehouse.id, odooProductId });
      }
      row.productName = productName ?? row.productName;
      row.quantity = String(line.quantity ?? 0);
      row.reservedQuantity = String(line.reserved_quantity ?? 0);
      row.syncedAt = new Date();
      await this.inventoryRepo.save(row);
    }

    warehouse.lastOdooSync = new Date();
    await this.warehouseRepo.save(warehouse);
    return { synced: lines.length };
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
