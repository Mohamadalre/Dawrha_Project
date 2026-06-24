import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
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
import {
  DeleteCategoryPayload,
  DeleteProductPayload,
  ODOO_JOBS,
  ODOO_SYNC_QUEUE,
  SyncCategoryPayload,
  SyncProductPayload,
  SyncWarehousePayload,
  UpdatePricingPayload,
} from './odoo-sync.constants';

@Processor(ODOO_SYNC_QUEUE)
export class OdooSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(OdooSyncProcessor.name);

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
        case ODOO_JOBS.SYNC_WAREHOUSE:
          return await this.syncWarehouse(job.data as SyncWarehousePayload);
        default:
          this.logger.warn(`Unknown Odoo job: ${job.name}`);
          return null;
      }
    } catch (error) {
      this.logger.error(`Job ${job.name} failed (attempt ${job.attemptsMade + 1})`, error as Error);
      if (isLastAttempt) {
        await this.compensate(job).catch((e) =>
          this.logger.error('Compensation failed', e as Error),
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
  }

  private async deleteProduct(payload: DeleteProductPayload) {
    await this.odoo.deleteProduct(payload.odooProductId);
  }

  // --- Pricing --------------------------------------------------------------
  private async updatePricing(payload: UpdatePricingPayload) {
    const product = await this.productRepo.findOne({ where: { id: payload.productId } });
    if (!product?.odooProductId) return;

    const price = await this.pricingRepo
      .createQueryBuilder('pp')
      .where('pp.productId = :id', { id: payload.productId })
      .andWhere('pp.tier = :tier', { tier: PricingTier.INDIVIDUAL })
      .orderBy('pp.effectiveFrom', 'DESC')
      .getOne();

    if (price) {
      // recycle.product uses `price` (not the standard `list_price`).
      await this.odoo.updateProduct(product.odooProductId, { price: Number(price.price) });
    }
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
        await this.notifyAdmins('فشل مزامنة التصنيف', `تعذّرت مزامنة التصنيف "${category.name}" مع Odoo وتمت إزالته.`);
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
        await this.notifyAdmins('فشل مزامنة المنتج', `تعذّرت مزامنة المنتج "${product.name}" مع Odoo وتمت إزالته.`);
      } else if (product) {
        product.odooSyncStatus = OdooSyncStatus.FAILED;
        await this.productRepo.save(product);
      }
    }
  }

  private async notifyAdmins(title: string, body: string): Promise<void> {
    try {
      const admins = await this.accountRepo.find({ where: { role: Role.ADMIN } });
      for (const admin of admins) {
        const n = await this.notifications.createNotification({
          userId: admin.id,
          title,
          body,
          type: NotificationType.ODOO,
        });
        await this.notifications.enqueueNotification(n.id);
      }
    } catch (error) {
      this.logger.warn('Failed to notify admins of Odoo failure', error as Error);
    }
  }
}
