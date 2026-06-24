import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WasteCategory } from '../entities/waste-category.entity';
import { Product } from '../entities/product.entity';
import { CartItem } from '../entities/cart-item.entity';
import { OdooSyncStatus } from '../enums/odoo-sync-status.enum';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';
import { AuditService } from '@src/waste-management/common/providers/audit.service';
import { CatalogCacheService } from '@src/waste-management/common/providers/catalog-cache.service';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import {
  AdminListQueryDto,
  CreateCategoryDto,
  CreateProductDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from './dto/admin-catalog.dto';

/**
 * Admin write-side for the catalogue. Every mutation is persisted locally with a
 * PENDING Odoo status and a sync job enqueued — the processor owns the Odoo RPC
 * and the compensation (delete-on-failure) behaviour.
 */
@Injectable()
export class AdminCatalogService {
  constructor(
    @InjectRepository(WasteCategory)
    private readonly categoryRepo: Repository<WasteCategory>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(CartItem)
    private readonly cartItemRepo: Repository<CartItem>,
    private readonly odooSync: OdooSyncService,
    private readonly audit: AuditService,
    private readonly cache: CatalogCacheService,
  ) {}

  // --- Categories -----------------------------------------------------------
  async listCategories(query: AdminListQueryDto) {
    const qb = this.categoryRepo.createQueryBuilder('c');
    this.applyStatus(qb, 'c', query.status);
    if (query.search) qb.andWhere('c.name ILIKE :s', { s: `%${query.search}%` });

    qb.orderBy('c.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    return {
      categories: rows,
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  async createCategory(adminId: string, dto: CreateCategoryDto) {
    const exists = await this.categoryRepo.findOne({ where: { name: dto.name } });
    if (exists) throw new BadRequestException('Category already exists');

    const category = await this.categoryRepo.save(
      this.categoryRepo.create({
        name: dto.name,
        description: dto.description,
        imageCategoryURL: dto.image ?? '',
        isActive: dto.is_active ?? true,
        odooSyncStatus: OdooSyncStatus.PENDING,
      }),
    );

    await this.odooSync.enqueueSyncCategory({ categoryId: category.id });
    await this.audit.record({
      userId: adminId,
      action: 'CREATE_CATEGORY',
      entityType: 'waste_category',
      entityId: category.id,
      newValues: { name: dto.name },
    });

    await this.cache.invalidate('categories');

    return {
      category_id: category.id,
      message: 'تم إضافة التصنيف بنجاح',
      odoo_status: 'PENDING_SYNC',
    };
  }

  async updateCategory(adminId: string, id: string, dto: UpdateCategoryDto) {
    const category = await this.categoryRepo.findOne({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');

    const before = { ...category };
    if (dto.name !== undefined) category.name = dto.name;
    if (dto.description !== undefined) category.description = dto.description;
    if (dto.image !== undefined) category.imageCategoryURL = dto.image;
    if (dto.is_active !== undefined) category.isActive = dto.is_active;
    category.odooSyncStatus = OdooSyncStatus.PENDING;
    await this.categoryRepo.save(category);

    await this.odooSync.enqueueSyncCategory({ categoryId: category.id });
    await this.audit.record({
      userId: adminId,
      action: 'UPDATE_CATEGORY',
      entityType: 'waste_category',
      entityId: id,
      oldValues: { name: before.name, isActive: before.isActive },
      newValues: { name: category.name, isActive: category.isActive },
    });

    await this.cache.invalidate('categories', 'products');

    return { category_id: id, odoo_status: 'PENDING_SYNC', message: 'تم تحديث التصنيف بنجاح' };
  }

  async deleteCategory(adminId: string, id: string) {
    const category = await this.categoryRepo.findOne({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');

    const productCount = await this.productRepo.count({ where: { categoryId: id } });
    if (productCount > 0) {
      throw new BadRequestException('Cannot delete a category that still has products');
    }

    if (category.odooCategoryId) {
      await this.odooSync.enqueueDeleteCategory({ odooCategoryId: category.odooCategoryId });
    }
    await this.categoryRepo.delete(id);
    await this.audit.record({
      userId: adminId,
      action: 'DELETE_CATEGORY',
      entityType: 'waste_category',
      entityId: id,
      oldValues: { name: category.name },
    });

    await this.cache.invalidate('categories', 'products');

    return { message: 'تم حذف التصنيف بنجاح' };
  }

  // --- Products -------------------------------------------------------------
  async listProducts(query: AdminListQueryDto) {
    const qb = this.productRepo.createQueryBuilder('p').leftJoinAndSelect('p.category', 'c');
    this.applyStatus(qb, 'p', query.status);
    if (query.category_id) qb.andWhere('p.categoryId = :cid', { cid: query.category_id });
    if (query.search) qb.andWhere('p.name ILIKE :s', { s: `%${query.search}%` });

    qb.orderBy('p.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    return {
      products: rows,
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  async createProduct(adminId: string, dto: CreateProductDto) {
    const category = await this.categoryRepo.findOne({ where: { id: dto.category_id } });
    if (!category) throw new BadRequestException('Category not found');

    const product = await this.productRepo.save(
      this.productRepo.create({
        name: dto.name,
        description: dto.description,
        categoryId: dto.category_id,
        imageURL: dto.image,
        unitType: dto.unit_type,
        isActive: dto.is_active ?? true,
        odooSyncStatus: OdooSyncStatus.PENDING,
      }),
    );

    await this.odooSync.enqueueSyncProduct({ productId: product.id });
    await this.audit.record({
      userId: adminId,
      action: 'CREATE_PRODUCT',
      entityType: 'product',
      entityId: product.id,
      newValues: { name: dto.name, categoryId: dto.category_id },
    });

    await this.cache.invalidate('products', 'categories');

    return { product_id: product.id, odoo_sync_status: 'PENDING_SYNC' };
  }

  async updateProduct(adminId: string, id: string, dto: UpdateProductDto) {
    const product = await this.productRepo.findOne({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');

    if (dto.name !== undefined) product.name = dto.name;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.category_id !== undefined) product.categoryId = dto.category_id;
    if (dto.image !== undefined) product.imageURL = dto.image;
    if (dto.unit_type !== undefined) product.unitType = dto.unit_type;
    if (dto.is_active !== undefined) product.isActive = dto.is_active;
    product.odooSyncStatus = OdooSyncStatus.PENDING;
    await this.productRepo.save(product);

    await this.odooSync.enqueueSyncProduct({ productId: id });
    await this.audit.record({
      userId: adminId,
      action: 'UPDATE_PRODUCT',
      entityType: 'product',
      entityId: id,
      newValues: { name: product.name },
    });

    await this.cache.invalidate('products', 'categories');

    return { product_id: id, odoo_sync_status: 'PENDING_SYNC' };
  }

  async deleteProduct(adminId: string, id: string) {
    const product = await this.productRepo.findOne({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');

    const inCart = await this.cartItemRepo.count({ where: { productId: id } });
    if (inCart > 0) {
      throw new BadRequestException('Cannot delete a product that is in active carts');
    }

    if (product.odooProductId) {
      await this.odooSync.enqueueDeleteProduct({ odooProductId: product.odooProductId });
    }
    await this.productRepo.delete(id);
    await this.audit.record({
      userId: adminId,
      action: 'DELETE_PRODUCT',
      entityType: 'product',
      entityId: id,
      oldValues: { name: product.name },
    });

    await this.cache.invalidate('products', 'categories');

    return { message: 'تم حذف المنتج بنجاح' };
  }

  // --- helpers --------------------------------------------------------------
  private applyStatus(qb: any, alias: string, status: 'active' | 'inactive' | 'all') {
    if (status === 'active') qb.andWhere(`${alias}.isActive = true`);
    else if (status === 'inactive') qb.andWhere(`${alias}.isActive = false`);
  }
}
