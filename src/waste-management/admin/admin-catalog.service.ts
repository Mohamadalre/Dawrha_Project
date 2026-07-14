import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WasteCategory } from '../entities/waste-category.entity';
import { Product } from '../entities/product.entity';
import { CartItem } from '../entities/cart-item.entity';
import { MeasurementUnit } from '../entities/measurement-unit.entity';
import { MaterialCondition } from '../entities/material-condition.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { Offer } from '../entities/offer.entity';
import { OdooSyncStatus } from '../enums/odoo-sync-status.enum';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';
import { AuditService } from '@src/waste-management/common/providers/audit.service';
import { CatalogCacheService } from '@src/waste-management/common/providers/catalog-cache.service';
import { UnitsService } from '@src/waste-management/common/providers/units.service';
import { ConditionsService } from '@src/waste-management/common/providers/conditions.service';
import {
  CategoryAlreadyExistsException,
  CategoryHasProductsException,
  CategoryNotFoundException,
  OfferNotFoundException,
  ProductInCartsException,
  ProductNotFoundException,
  ConditionAlreadyExistsException,
  ConditionInUseException,
  ConditionNotFoundException,
  UnitAlreadyExistsException,
  UnitInUseException,
  UnitNotFoundException,
  UnitUsedByActiveProductsException,
} from '../exceptions/waste.exceptions';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import {
  AdminListQueryDto,
  CreateCategoryDto,
  CreateConditionDto,
  CreateOfferDto,
  CreateProductDto,
  CreateUnitDto,
  UpdateCategoryDto,
  UpdateConditionDto,
  UpdateOfferDto,
  UpdateProductDto,
  UpdateUnitDto,
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
    @InjectRepository(MeasurementUnit)
    private readonly unitRepo: Repository<MeasurementUnit>,
    @InjectRepository(MaterialCondition)
    private readonly conditionRepo: Repository<MaterialCondition>,
    @InjectRepository(ProductPricing)
    private readonly pricingRepo: Repository<ProductPricing>,
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    private readonly odooSync: OdooSyncService,
    private readonly audit: AuditService,
    private readonly cache: CatalogCacheService,
    private readonly units: UnitsService,
    private readonly conditionsService: ConditionsService,
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
      categories: rows.map((c) => this.mapAdminCategory(c)),
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  async createCategory(adminId: string, dto: CreateCategoryDto) {
    const exists = await this.categoryRepo.findOne({ where: { name: dto.name } });
    if (exists) throw new CategoryAlreadyExistsException();

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
      message: 'Category created successfully',
      odoo_status: 'PENDING_SYNC',
    };
  }

  async updateCategory(adminId: string, id: string, dto: UpdateCategoryDto) {
    const category = await this.categoryRepo.findOne({ where: { id } });
    if (!category) throw new CategoryNotFoundException();

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

    return { category_id: id, odoo_status: 'PENDING_SYNC', message: 'Category updated successfully' };
  }

  async deleteCategory(adminId: string, id: string) {
    const category = await this.categoryRepo.findOne({ where: { id } });
    if (!category) throw new CategoryNotFoundException();

    const productCount = await this.productRepo.count({ where: { categoryId: id } });
    if (productCount > 0) {
      throw new CategoryHasProductsException();
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

    return { message: 'Category deleted successfully' };
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
      products: rows.map((p) => this.mapAdminProduct(p)),
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  async createProduct(adminId: string, dto: CreateProductDto) {
    const category = await this.categoryRepo.findOne({ where: { id: dto.category_id } });
    if (!category) throw new CategoryNotFoundException();

    const unitCode = await this.units.validateActiveCode(dto.unit_type);

    const product = await this.productRepo.save(
      this.productRepo.create({
        name: dto.name,
        description: dto.description,
        categoryId: dto.category_id,
        imageURL: dto.image,
        unitType: unitCode,
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
    if (!product) throw new ProductNotFoundException();

    if (dto.name !== undefined) product.name = dto.name;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.category_id !== undefined) product.categoryId = dto.category_id;
    if (dto.image !== undefined) product.imageURL = dto.image;
    if (dto.unit_type !== undefined) {
      product.unitType = await this.units.validateActiveCode(dto.unit_type);
    }
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
    if (!product) throw new ProductNotFoundException();

    const inCart = await this.cartItemRepo.count({ where: { productId: id } });
    if (inCart > 0) {
      throw new ProductInCartsException();
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

    return { message: 'Product deleted successfully' };
  }

  // --- Measurement units ------------------------------------------------------
  // Units are admin-managed (no fixed enum). Products/cart items store the unit
  // `code`; deleting is only allowed while unused — otherwise deactivate.
  async listUnits() {
    const units = await this.unitRepo.find({ order: { code: 'ASC' } });
    return { units: units.map((u) => this.mapUnit(u)) };
  }

  async createUnit(adminId: string, dto: CreateUnitDto) {
    const exists = await this.unitRepo.findOne({ where: { code: dto.code } });
    if (exists) throw new UnitAlreadyExistsException();

    const unit = await this.unitRepo.save(
      this.unitRepo.create({
        code: dto.code,
        nameEn: dto.name_en,
        nameAr: dto.name_ar,
        isWeight: dto.is_weight ?? false,
        // Sorting tolerance defaults to the weight-ness of the unit:
        // weight units tolerate quantity drift, count units must match exactly.
        allowsTolerance: dto.allows_tolerance ?? dto.is_weight ?? false,
        odooSyncStatus: OdooSyncStatus.PENDING,
      }),
    );

    // Mirror to the Odoo warehouse addon (sorting reads allows_tolerance there).
    await this.odooSync.enqueueSyncUnit({ unitId: unit.id });
    this.units.invalidate();
    await this.audit.record({
      userId: adminId,
      action: 'CREATE_UNIT',
      entityType: 'measurement_unit',
      entityId: unit.id,
      newValues: { code: unit.code, allowsTolerance: unit.allowsTolerance },
    });

    return { unit: this.mapUnit(unit), message: 'Unit created successfully' };
  }

  async updateUnit(adminId: string, id: string, dto: UpdateUnitDto) {
    const unit = await this.unitRepo.findOne({ where: { id } });
    if (!unit) throw new UnitNotFoundException();

    // Deactivating a unit still carried by active products would orphan them.
    if (dto.is_active === false && unit.isActive) {
      const inUse = await this.productRepo.count({
        where: { unitType: unit.code, isActive: true },
      });
      if (inUse > 0) {
        throw new UnitUsedByActiveProductsException();
      }
    }

    const before = {
      nameEn: unit.nameEn,
      nameAr: unit.nameAr,
      isWeight: unit.isWeight,
      allowsTolerance: unit.allowsTolerance,
      isActive: unit.isActive,
    };
    if (dto.name_en !== undefined) unit.nameEn = dto.name_en;
    if (dto.name_ar !== undefined) unit.nameAr = dto.name_ar;
    if (dto.is_weight !== undefined) unit.isWeight = dto.is_weight;
    if (dto.allows_tolerance !== undefined) unit.allowsTolerance = dto.allows_tolerance;
    if (dto.is_active !== undefined) unit.isActive = dto.is_active;
    unit.odooSyncStatus = OdooSyncStatus.PENDING;
    const saved = await this.unitRepo.save(unit);

    // Push the edit (esp. allows_tolerance) to Odoo so sorting rules stay current.
    await this.odooSync.enqueueSyncUnit({ unitId: saved.id });
    this.units.invalidate();
    // Product payloads embed the unit label — drop stale cached pages.
    await this.cache.invalidate('products');
    await this.audit.record({
      userId: adminId,
      action: 'UPDATE_UNIT',
      entityType: 'measurement_unit',
      entityId: id,
      oldValues: before,
      newValues: { ...dto },
    });

    return { unit: this.mapUnit(saved), message: 'Unit updated successfully' };
  }

  async deleteUnit(adminId: string, id: string) {
    const unit = await this.unitRepo.findOne({ where: { id } });
    if (!unit) throw new UnitNotFoundException();

    const inUse = await this.productRepo.count({ where: { unitType: unit.code } });
    if (inUse > 0) {
      throw new UnitInUseException();
    }

    if (unit.odooUnitId) {
      await this.odooSync.enqueueDeleteUnit({ odooUnitId: unit.odooUnitId });
    }
    await this.unitRepo.delete(id);
    this.units.invalidate();
    await this.audit.record({
      userId: adminId,
      action: 'DELETE_UNIT',
      entityType: 'measurement_unit',
      entityId: id,
      oldValues: { code: unit.code },
    });

    return { message: 'Unit deleted successfully' };
  }

  private mapUnit(u: MeasurementUnit) {
    return {
      id: u.id,
      code: u.code,
      name_en: u.nameEn,
      name_ar: u.nameAr,
      is_weight: u.isWeight,
      allows_tolerance: u.allowsTolerance,
      is_active: u.isActive,
      odoo_sync_status: u.odooSyncStatus,
      created_at: u.createdAt,
    };
  }

  // --- Offers -----------------------------------------------------------------
  // Admin-authored discounts on one product. An offer may target one material
  // condition (grade) — graded buyers (factory / free-facility) then see and
  // buy the offer for that grade specifically.
  async listOffers(query: AdminListQueryDto) {
    const qb = this.offerRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.product', 'p');
    this.applyStatus(qb, 'o', query.status);
    if (query.search) qb.andWhere('p.name ILIKE :s', { s: `%${query.search}%` });

    qb.orderBy('o.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    return {
      offers: rows.map((o) => this.mapAdminOffer(o)),
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  async createOffer(adminId: string, dto: CreateOfferDto) {
    const product = await this.productRepo.findOne({ where: { id: dto.product_id } });
    if (!product) throw new ProductNotFoundException();

    const conditionCode = dto.condition
      ? await this.conditionsService.validateActiveCode(dto.condition)
      : null;

    const offer = await this.offerRepo.save(
      this.offerRepo.create({
        productId: dto.product_id,
        offerPrice: String(dto.offer_price),
        discountPercentage: String(dto.discount_percentage ?? 0),
        conditionCode,
        targetRoles: dto.target_roles?.length ? dto.target_roles : null,
        description: dto.description,
        validFrom: dto.valid_from ? new Date(dto.valid_from) : new Date(),
        validUntil: dto.valid_until ? new Date(dto.valid_until) : undefined,
      }),
    );

    await this.cache.invalidate('offers', 'products');
    await this.audit.record({
      userId: adminId,
      action: 'CREATE_OFFER',
      entityType: 'offer',
      entityId: offer.id,
      newValues: { productId: dto.product_id, price: dto.offer_price, condition: conditionCode },
    });

    return { offer: this.mapAdminOffer(offer), message: 'Offer created successfully' };
  }

  async updateOffer(adminId: string, id: string, dto: UpdateOfferDto) {
    const offer = await this.offerRepo.findOne({ where: { id } });
    if (!offer) throw new OfferNotFoundException();

    if (dto.offer_price !== undefined) offer.offerPrice = String(dto.offer_price);
    if (dto.discount_percentage !== undefined) offer.discountPercentage = String(dto.discount_percentage);
    if (dto.condition !== undefined) {
      offer.conditionCode = dto.condition
        ? await this.conditionsService.validateActiveCode(dto.condition)
        : null;
    }
    if (dto.target_roles !== undefined) {
      offer.targetRoles = dto.target_roles.length ? dto.target_roles : null;
    }
    if (dto.description !== undefined) offer.description = dto.description;
    if (dto.valid_from !== undefined) offer.validFrom = new Date(dto.valid_from);
    if (dto.valid_until !== undefined) offer.validUntil = dto.valid_until ? new Date(dto.valid_until) : undefined;
    if (dto.is_active !== undefined) offer.isActive = dto.is_active;
    const saved = await this.offerRepo.save(offer);

    await this.cache.invalidate('offers', 'products');
    await this.audit.record({
      userId: adminId,
      action: 'UPDATE_OFFER',
      entityType: 'offer',
      entityId: id,
      newValues: { ...dto },
    });

    return { offer: this.mapAdminOffer(saved), message: 'Offer updated successfully' };
  }

  async deleteOffer(adminId: string, id: string) {
    const offer = await this.offerRepo.findOne({ where: { id } });
    if (!offer) throw new OfferNotFoundException();

    await this.offerRepo.delete(id);
    await this.cache.invalidate('offers', 'products');
    await this.audit.record({
      userId: adminId,
      action: 'DELETE_OFFER',
      entityType: 'offer',
      entityId: id,
      oldValues: { productId: offer.productId },
    });

    return { message: 'Offer deleted successfully' };
  }

  private mapAdminOffer(o: Offer) {
    return {
      offer_id: o.id,
      product_id: o.productId,
      product_name: o.product?.name ?? null,
      offer_price: Number(o.offerPrice),
      discount_percentage: Number(o.discountPercentage),
      condition: o.conditionCode ?? null,
      target_roles: o.targetRoles ?? null,
      description: o.description ?? null,
      valid_from: o.validFrom,
      valid_until: o.validUntil ?? null,
      is_active: o.isActive,
    };
  }

  // --- Material conditions ------------------------------------------------------
  // Admin-managed grades used by the Odoo sorter and by FACTORY/FREE_FACILITY
  // pricing. Every mutation is mirrored to Odoo (SYNC_CONDITION job).
  async listConditions() {
    const conditions = await this.conditionRepo.find({
      order: { sortOrder: 'ASC', code: 'ASC' },
    });
    return { conditions: conditions.map((c) => this.mapCondition(c)) };
  }

  async createCondition(adminId: string, dto: CreateConditionDto) {
    const exists = await this.conditionRepo.findOne({ where: { code: dto.code } });
    if (exists) throw new ConditionAlreadyExistsException();

    const condition = await this.conditionRepo.save(
      this.conditionRepo.create({
        code: dto.code,
        nameEn: dto.name_en,
        nameAr: dto.name_ar,
        sortOrder: dto.sort_order ?? 0,
        odooSyncStatus: OdooSyncStatus.PENDING,
      }),
    );

    await this.odooSync.enqueueSyncCondition({ conditionId: condition.id });
    this.conditionsService.invalidate();
    await this.audit.record({
      userId: adminId,
      action: 'CREATE_CONDITION',
      entityType: 'material_condition',
      entityId: condition.id,
      newValues: { code: condition.code },
    });

    return { condition: this.mapCondition(condition), message: 'Condition created successfully' };
  }

  async updateCondition(adminId: string, id: string, dto: UpdateConditionDto) {
    const condition = await this.conditionRepo.findOne({ where: { id } });
    if (!condition) throw new ConditionNotFoundException();

    // Deactivating a grade that still has live prices would strand those rows.
    if (dto.is_active === false && condition.isActive) {
      const pricedWith = await this.pricingRepo.count({ where: { conditionCode: condition.code } });
      if (pricedWith > 0) throw new ConditionInUseException();
    }

    const before = {
      nameEn: condition.nameEn,
      nameAr: condition.nameAr,
      sortOrder: condition.sortOrder,
      isActive: condition.isActive,
    };
    if (dto.name_en !== undefined) condition.nameEn = dto.name_en;
    if (dto.name_ar !== undefined) condition.nameAr = dto.name_ar;
    if (dto.sort_order !== undefined) condition.sortOrder = dto.sort_order;
    if (dto.is_active !== undefined) condition.isActive = dto.is_active;
    condition.odooSyncStatus = OdooSyncStatus.PENDING;
    const saved = await this.conditionRepo.save(condition);

    await this.odooSync.enqueueSyncCondition({ conditionId: saved.id });
    this.conditionsService.invalidate();
    await this.cache.invalidate('products');
    await this.audit.record({
      userId: adminId,
      action: 'UPDATE_CONDITION',
      entityType: 'material_condition',
      entityId: id,
      oldValues: before,
      newValues: { ...dto },
    });

    return { condition: this.mapCondition(saved), message: 'Condition updated successfully' };
  }

  async deleteCondition(adminId: string, id: string) {
    const condition = await this.conditionRepo.findOne({ where: { id } });
    if (!condition) throw new ConditionNotFoundException();

    const inUse = await this.pricingRepo.count({ where: { conditionCode: condition.code } });
    if (inUse > 0) throw new ConditionInUseException();

    if (condition.odooConditionId) {
      await this.odooSync.enqueueDeleteCondition({ odooConditionId: condition.odooConditionId });
    }
    await this.conditionRepo.delete(id);
    this.conditionsService.invalidate();
    await this.audit.record({
      userId: adminId,
      action: 'DELETE_CONDITION',
      entityType: 'material_condition',
      entityId: id,
      oldValues: { code: condition.code },
    });

    return { message: 'Condition deleted successfully' };
  }

  private mapCondition(c: MaterialCondition) {
    return {
      id: c.id,
      code: c.code,
      name_en: c.nameEn,
      name_ar: c.nameAr,
      sort_order: c.sortOrder,
      is_active: c.isActive,
      odoo_sync_status: c.odooSyncStatus,
      created_at: c.createdAt,
    };
  }

  /** Unified snake_case shape for the admin category list (no raw entities). */
  private mapAdminCategory(c: WasteCategory) {
    return {
      id: c.id,
      name: c.name,
      description: c.description ?? null,
      image: c.imageCategoryURL || null,
      is_active: c.isActive,
      odoo_category_id: c.odooCategoryId ?? null,
      odoo_sync_status: c.odooSyncStatus,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    };
  }

  /** Unified snake_case shape for the admin product list (no raw entities). */
  private mapAdminProduct(p: Product) {
    return {
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      image: p.imageURL ?? null,
      category: p.category ? { id: p.category.id, name: p.category.name } : null,
      unit_type: p.unitType,
      is_active: p.isActive,
      odoo_product_id: p.odooProductId ?? null,
      odoo_sync_status: p.odooSyncStatus,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    };
  }

  // --- helpers --------------------------------------------------------------
  private applyStatus(qb: any, alias: string, status: 'active' | 'inactive' | 'all') {
    if (status === 'active') qb.andWhere(`${alias}.isActive = true`);
    else if (status === 'inactive') qb.andWhere(`${alias}.isActive = false`);
  }
}
