import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WasteCategory } from '../entities/waste-category.entity';
import { Product } from '../entities/product.entity';
import { CartItem } from '../entities/cart-item.entity';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
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
  ProductHasStockException,
  ProductNotFoundException,
  ConditionAlreadyExistsException,
  ConditionInUseException,
  ConditionNotFoundException,
  UnitAlreadyExistsException,
  UnitInUseException,
  UnitNotFoundException,
  UnitUsedByActiveProductsException,
  UnitRequiredException,
  UnitMismatchException,
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
    @InjectRepository(WarehouseInventory)
    private readonly inventoryRepo: Repository<WarehouseInventory>,
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
    const qb = this.productRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.category', 'c')
      .leftJoinAndSelect('p.unit', 'u');
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

  /**
   * The unit a material is to be measured in, named by ID.
   *
   * By id and nothing else. The code was accepted for a while and is not any
   * more: a code is a label that can be renamed and re-used, so two callers
   * sending "KG" could mean two different rows — and a material's unit decides
   * how every quantity of it is read, priced and sorted. An id names one row
   * for good, which is the same reason the category is given by id.
   *
   * `unitType` is still WRITTEN from the resolved row, because Odoo, the cart
   * and the suggestion flow all read a code; it is a denormalised label now,
   * never an input.
   */
  private async resolveUnit(
    unitId: string | undefined,
    required: boolean,
  ): Promise<MeasurementUnit> {
    if (unitId) return this.units.resolveActiveById(unitId);
    if (required) throw new UnitRequiredException();
    return null as unknown as MeasurementUnit;
  }

  async createProduct(adminId: string, dto: CreateProductDto) {
    const category = await this.categoryRepo.findOne({ where: { id: dto.category_id } });
    if (!category) throw new CategoryNotFoundException();

    const unit = await this.resolveUnit(dto.unit_id, true);

    const product = await this.productRepo.save(
      this.productRepo.create({
        name: dto.name,
        description: dto.description,
        categoryId: dto.category_id,
        imageURL: dto.image,
        // Both written together, always. `unitId` is the link; `unitType` is
        // the denormalised code Odoo and the cart read, and letting the two
        // drift apart would mean the material is measured in one unit and
        // priced in another.
        unitId: unit.id,
        unitType: unit.code,
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
    if (dto.unit_id !== undefined) {
      const unit = await this.resolveUnit(dto.unit_id, true);
      product.unitId = unit.id;
      product.unitType = unit.code;
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

    // A material still sitting on a warehouse floor cannot be deleted.
    //
    // The rows here mirror Odoo, which is the only writer of quantities — so
    // deleting the material would leave real, physical stock described by a
    // catalogue entry that no longer exists: the warehouse can see it, the
    // system cannot name it, and no order can ever be raised to clear it. The
    // material has to reach zero first, which means selling or writing it off
    // — both of which are decisions, not side effects of a delete.
    if (product.odooProductId) {
      const held = await this.inventoryRepo
        .createQueryBuilder('i')
        .select('COALESCE(SUM(i.quantity), 0)', 'total')
        .where('i.odooProductId = :odooProductId', {
          odooProductId: product.odooProductId,
        })
        .getRawOne<{ total: string }>();

      const remaining = Number(held?.total ?? 0);
      if (remaining > 0) {
        throw new ProductHasStockException(product.name, remaining);
      }
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
      ? await this.conditionsService.validateActiveCode(dto.product_id, dto.condition)
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
        ? await this.conditionsService.validateActiveCode(offer.productId, dto.condition)
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
  // Moved out: grades belong to a MATERIAL, not to a global list, so they are
  // managed by ProductConditionsService under the product they describe.
  // A flat collection here is what made them global and forced every material
  // to borrow another's vocabulary.

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

  private mapAdminProduct(p: Product) {
    return {
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      image: p.imageURL ?? null,
      category: p.category ? { id: p.category.id, name: p.category.name } : null,
      // The unit as a LINK, next to the code older clients still read. Only
      // the identity and the name — the flags that decide sorting tolerance
      // and the weight rule belong to the units screen, not to a material
      // listing that never acts on them.
      unit: p.unit
        ? {
            id: p.unit.id,
            code: p.unit.code,
            name_en: p.unit.nameEn,
            name_ar: p.unit.nameAr,
          }
        : null,
      unit_id: p.unitId ?? null,
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
