import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, In, Not, Repository } from 'typeorm';
import { WasteCategory } from '../entities/waste-category.entity';
import { Product } from '../entities/product.entity';
import { CartItem } from '../entities/cart-item.entity';
import { WarehouseInventory } from '@src/warehouse/entities/warehouse-inventory.entity';
import { OrderPartLine } from '@src/order/entities/order-part-line.entity';
import { MeasurementUnit } from '../entities/measurement-unit.entity';
import { MaterialCondition } from '../entities/material-condition.entity';
import { ProductPricing } from '../entities/product-pricing.entity';
import { ProductPricingHistory } from '../entities/product-pricing-history.entity';
import { PricingArchiveReason } from '../enums/pricing-archive-reason.enum';
import { Offer } from '../entities/offer.entity';
import { Role } from '@src/user/enums/role.enum';
import { Account } from '@src/user/entities/account.entity';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { NotificationService } from '@src/notification/notification.service';
import { NotificationType } from '@src/notification/enums/notification-type.enum';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { OdooSyncStatus } from '../enums/odoo-sync-status.enum';
import { PricingTier, tierForRole } from '../enums/pricing-tier.enum';
import {
  AUDIENCE_ROLES,
  OfferAudience,
  offerPercentage,
  tiersForAudience,
} from '../enums/offer-audience.enum';
import { OfferBasis, amountFromPercentage } from '../enums/offer-basis.enum';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';
import { AuditService } from '@src/waste-management/common/providers/audit.service';
import { CatalogCacheService } from '@src/waste-management/common/providers/catalog-cache.service';
import { CloudinaryService } from '@src/core/cloudinary/cloudinary.service';
import { UnitsService } from '@src/waste-management/common/providers/units.service';
import { ConditionsService } from '@src/waste-management/common/providers/conditions.service';
import {
  CategoryAlreadyExistsException,
  CategoryHasProductsException,
  CategoryNotFoundException,
  OfferNotFoundException,
  ProductInCartsException,
  ProductHasOrdersException,
  ProductHasStockException,
  ProductNotFoundException,
  ProductAlreadyExistsException,
  ImageRequiredException,
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
  OFFER_TARGETABLE_ROLES,
  CreateCategoryDto,
  CreateConditionDto,
  CreateOfferDto,
  CreateProductDto,
  CreateUnitDto,
  UpdateCategoryDto,
  UpdateConditionDto,
  UpdateOfferDto,
  OfferTimelineQueryDto,
  UpdateProductDto,
  UpdateUnitDto,
} from './dto/admin-catalog.dto';

/**
 * One offer row this request will produce.
 *
 * Both the grade's ID and its CODE travel: the id is the link the database
 * enforces, the code is the join key the price sheet and the basket are keyed
 * by. The code is always copied from the resolved grade, never from the
 * request, so the pair cannot disagree.
 *
 * `amount` is what MOVES the price — added for sellers, taken off for buyers —
 * and `percentage` is what that represents, derived from the base it faces.
 */
interface OfferPlanRow {
  conditionId: string | null;
  conditionCode: string | null;
  amount: number;
  roles: Role[];
  audience: OfferAudience;
  percentage: number;
  /**
   * What the administrator PROMISED — and so what a later price edit must keep.
   *
   * AMOUNT rows keep their number; PERCENTAGE rows keep their ratio and have
   * the amount recomputed. Distinct from `percentage` above, which is derived
   * and exists for every row.
   */
  basis: OfferBasis;
  basisPercentage: number | null;
  /**
   * True when the admin TARGETED the role(s) explicitly; false for a general
   * (audience-wide) offer. Carried onto the row so a specific offer can override
   * a general one for the same role. See {@link Offer.roleSpecific}.
   */
  roleSpecific: boolean;
}

/**
 * The one unit that needs no weight conversion: a kilogram IS the delivery
 * capacity's own measure, so a material sold in it carries no per-unit weight.
 */
const KG_UNIT_CODE = 'KG';

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
    private readonly cloudinary: CloudinaryService,
    // Offer creation writes SEVERAL rows for one request; they commit together
    // or not at all, so a graded offer can never land half-priced.
    private readonly dataSource: DataSource,
    // Deleting a material has to know whether any ORDER ever named it: an order
    // line is a frozen contract (RESTRICT foreign key), so a material with order
    // history can only be deactivated, never erased.
    @InjectRepository(OrderPartLine)
    private readonly orderLineRepo: Repository<OrderPartLine>,
    // A new offer notifies every ACTIVE account in its target audience.
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly notifications: NotificationService,
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

  /** One category by id (admin view). */
  async getCategoryById(id: string) {
    const category = await this.categoryRepo.findOne({ where: { id } });
    if (!category) throw new CategoryNotFoundException();
    return this.mapAdminCategory(category);
  }

  /** One material by id (admin view), with its category and unit. */
  async getProductById(id: string) {
    const product = await this.productRepo.findOne({
      where: { id },
      relations: ['category', 'unit'],
    });
    if (!product) throw new ProductNotFoundException();
    const [priced, offered] = await Promise.all([
      this.livePricedProductIds([product.id]),
      this.liveOfferedProductIds([product.id]),
    ]);
    return this.mapAdminProduct(
      product,
      priced.has(product.id),
      offered.has(product.id),
    );
  }

  /**
   * Create a category — the admin route, which also queues the Odoo sync and
   * writes an audit entry. This is the single category-create endpoint again
   * (POST /admin/waste/categories); the older /waste-management/waste-category
   * route was removed in its favour.
   */
  async createCategory(adminId: string, dto: CreateCategoryDto, imageUrl?: string) {
    // An image is mandatory: a category with no picture renders as a broken
    // tile in every client, so it is rejected before we write anything.
    if (!imageUrl) throw new ImageRequiredException();

    // Case-insensitive so "Plastic" and "plastic" cannot both exist.
    const exists = await this.categoryRepo.findOne({ where: { name: ILike(dto.name) } });
    if (exists) throw new CategoryAlreadyExistsException();

    const category = await this.categoryRepo.save(
      this.categoryRepo.create({
        name: dto.name,
        description: dto.description,
        imageCategoryURL: imageUrl,
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
      name: category.name,
      is_active: category.isActive,
      odoo_status: 'PENDING_SYNC',
    };
  }

  async updateCategory(adminId: string, id: string, dto: UpdateCategoryDto, imageUrl?: string) {
    const category = await this.categoryRepo.findOne({ where: { id } });
    if (!category) throw new CategoryNotFoundException();

    const before = { ...category };

    // Renaming onto an existing name (case-insensitive, excluding self) is a
    // duplicate just like creating one.
    if (dto.name !== undefined && dto.name !== category.name) {
      const clash = await this.categoryRepo.findOne({
        where: { name: ILike(dto.name), id: Not(id) },
      });
      if (clash) throw new CategoryAlreadyExistsException();
      category.name = dto.name;
    }
    if (dto.description !== undefined) category.description = dto.description;

    // Replacing the image: remember the old URL, swap in the new one, and delete
    // the old asset from Cloudinary AFTER the row is saved — so a failed save
    // never destroys the image the row still points at.
    let oldImageUrl: string | null = null;
    if (imageUrl !== undefined && imageUrl !== category.imageCategoryURL) {
      oldImageUrl = category.imageCategoryURL || null;
      category.imageCategoryURL = imageUrl;
    }
    if (dto.is_active !== undefined) category.isActive = dto.is_active;
    category.odooSyncStatus = OdooSyncStatus.PENDING;
    await this.categoryRepo.save(category);

    if (oldImageUrl) await this.cloudinary.deleteByUrl(oldImageUrl);

    await this.odooSync.enqueueSyncCategory({ categoryId: category.id });
    await this.audit.record({
      userId: adminId,
      action: 'UPDATE_CATEGORY',
      entityType: 'waste_category',
      entityId: id,
      oldValues: { name: before.name, isActive: before.isActive },
      newValues: { name: category.name, isActive: category.isActive },
    });

    await this.cache.invalidate('categories', 'products', 'offers');

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

    await this.cache.invalidate('categories', 'products', 'offers');

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
    const ids = rows.map((p) => p.id);
    const [priced, offered] = await Promise.all([
      this.livePricedProductIds(ids),
      this.liveOfferedProductIds(ids),
    ]);
    return {
      products: rows.map((p) =>
        this.mapAdminProduct(p, priced.has(p.id), offered.has(p.id)),
      ),
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  /**
   * Every material with its category, its unit, its grades, and its CURRENT
   * price for ALL FOUR buyer roles at once — the admin's one screen to see how
   * a material is priced across the whole buyer base.
   *
   * Prices are the ones in force NOW (`effectiveFrom <= now < effectiveUntil`).
   * Each role entry carries a `base` (the flat price, used by citizens and
   * institutions and by any ungraded material) and a `by_condition` list (the
   * per-grade prices factories and free facilities are charged). A role a
   * material is not priced for shows `base: null` and an empty `by_condition` —
   * that is real information ("not sold to this role"), not a gap.
   *
   * Page-bounded and free of N+1: one products query, one prices query, one
   * conditions query, assembled in memory.
   */
  async materialsPricingOverview(query: AdminListQueryDto) {
    const qb = this.productRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.category', 'c')
      .leftJoinAndSelect('p.unit', 'u');
    this.applyStatus(qb, 'p', query.status);
    if (query.category_id) qb.andWhere('p.categoryId = :cid', { cid: query.category_id });
    if (query.search) qb.andWhere('p.name ILIKE :s', { s: `%${query.search}%` });
    qb.orderBy('p.name', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [products, total] = await qb.getManyAndCount();
    const ids = products.map((p) => p.id);
    if (ids.length === 0) {
      return { materials: [], pagination: buildPagination(0, query.page, query.limit) };
    }

    const [priceRows, conditionRows] = await Promise.all([
      this.pricingRepo
        .createQueryBuilder('pp')
        .where('pp.productId IN (:...ids)', { ids })
        .andWhere('pp.effectiveFrom <= NOW()')
        .andWhere('(pp.effectiveUntil IS NULL OR pp.effectiveUntil > NOW())')
        .getMany(),
      this.conditionRepo.find({
        where: { productId: In(ids), isActive: true },
        order: { sortOrder: 'ASC' },
      }),
    ]);

    const pricesByProduct = new Map<string, ProductPricing[]>();
    for (const r of priceRows) {
      (pricesByProduct.get(r.productId) ?? pricesByProduct.set(r.productId, []).get(r.productId)!).push(r);
    }
    const condsByProduct = new Map<string, MaterialCondition[]>();
    for (const c of conditionRows) {
      (condsByProduct.get(c.productId) ?? condsByProduct.set(c.productId, []).get(c.productId)!).push(c);
    }

    const materials = products.map((p) => ({
      id: p.id,
      name: p.name,
      is_active: p.isActive,
      category: p.category ? { id: p.category.id, name: p.category.name } : null,
      unit: p.unit
        ? { id: p.unit.id, code: p.unit.code, name_en: p.unit.nameEn, name_ar: p.unit.nameAr }
        : null,
      conditions: (condsByProduct.get(p.id) ?? []).map((c) => ({
        id: c.id,
        code: c.code,
        name_en: c.nameEn,
        name_ar: c.nameAr,
      })),
      prices: this.shapeAllRolePrices(pricesByProduct.get(p.id) ?? []),
    }));

    return { materials, pagination: buildPagination(total, query.page, query.limit) };
  }

  /** The current price of one material for every role, from its pricing rows. */
  private shapeAllRolePrices(rows: ProductPricing[]) {
    const ROLE_TIERS: Array<{ role: Role; tier: PricingTier }> = [
      { role: Role.CITIZEN, tier: PricingTier.INDIVIDUAL },
      { role: Role.INSTITUTIONS, tier: PricingTier.COMPANY },
      { role: Role.FACTORY, tier: PricingTier.FACTORY },
      { role: Role.EXTERNAL_PARTNER, tier: PricingTier.FREE_FACILITY },
    ];
    return ROLE_TIERS.map(({ role, tier }) => {
      const tierRows = rows.filter((r) => r.tier === tier);
      const base = tierRows.find((r) => !r.conditionId);
      const byCondition = tierRows
        .filter((r) => r.conditionId)
        .map((r) => ({
          condition_id: r.conditionId,
          code: r.conditionCode ?? '',
          price: Number(r.price),
        }));
      return {
        role,
        tier,
        base: base ? Number(base.price) : null,
        currency: base?.currency ?? tierRows[0]?.currency ?? 'SYP',
        by_condition: byCondition,
      };
    });
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

  /**
   * The per-unit weight to STORE, given the material's unit and what the admin
   * sent.
   *
   * A kilogram already weighs a kilogram, so a KG material stores null and any
   * figure sent for it is ignored. Every other unit MUST carry a weight, because
   * delivery capacity is measured in kilograms and a piece-count says nothing
   * about load — so a non-kg material with neither a new figure nor an existing
   * one is refused. On update, an unchanged non-kg material keeps the weight it
   * already had when none is resent.
   */
  private resolveUnitWeight(
    unitCode: string,
    provided?: number,
    existing?: string | null,
  ): string | null {
    if (unitCode === KG_UNIT_CODE) return null;
    if (provided !== undefined) return String(provided);
    if (existing != null) return existing;
    throw new BadRequestException(
      'This material is not measured in kilograms, so its weight in kilograms per unit is required — delivery capacity is measured by weight',
    );
  }

  async createProduct(adminId: string, dto: CreateProductDto, imageUrl?: string) {
    if (!imageUrl) throw new ImageRequiredException();

    const category = await this.categoryRepo.findOne({ where: { id: dto.category_id } });
    if (!category) throw new CategoryNotFoundException();

    // Case-insensitive duplicate-name guard, same rule as categories.
    const exists = await this.productRepo.findOne({ where: { name: ILike(dto.name) } });
    if (exists) throw new ProductAlreadyExistsException();

    const unit = await this.resolveUnit(dto.unit_id, true);
    // A non-kg material must declare its weight up front — refused here, before
    // anything is written, rather than surfacing when a route cannot be loaded.
    const unitWeightKg = this.resolveUnitWeight(unit.code, dto.unit_weight_kg);

    const product = await this.productRepo.save(
      this.productRepo.create({
        name: dto.name,
        description: dto.description,
        categoryId: dto.category_id,
        imageURL: imageUrl,
        // Both written together, always. `unitId` is the link; `unitType` is
        // the denormalised code Odoo and the cart read, and letting the two
        // drift apart would mean the material is measured in one unit and
        // priced in another.
        unitId: unit.id,
        unitType: unit.code,
        unitWeightKg,
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

    await this.cache.invalidate('products', 'categories', 'offers');

    return { product_id: product.id, odoo_sync_status: 'PENDING_SYNC' };
  }

  async updateProduct(adminId: string, id: string, dto: UpdateProductDto, imageUrl?: string) {
    const product = await this.productRepo.findOne({ where: { id } });
    if (!product) throw new ProductNotFoundException();

    // Remember the unit so a change can be pushed into any live basket line.
    const prevUnitType = product.unitType;

    if (dto.name !== undefined && dto.name !== product.name) {
      const clash = await this.productRepo.findOne({
        where: { name: ILike(dto.name), id: Not(id) },
      });
      if (clash) throw new ProductAlreadyExistsException();
      product.name = dto.name;
    }
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.category_id !== undefined) product.categoryId = dto.category_id;

    // Same replace-then-clean-up-old rule as categories.
    let oldImageUrl: string | null = null;
    if (imageUrl !== undefined && imageUrl !== product.imageURL) {
      oldImageUrl = product.imageURL || null;
      product.imageURL = imageUrl;
    }
    if (dto.unit_id !== undefined) {
      const unit = await this.resolveUnit(dto.unit_id, true);
      product.unitId = unit.id;
      product.unitType = unit.code;
    }
    // Re-resolve the weight whenever the unit or the weight itself is touched:
    // switching TO kg clears it, switching AWAY from kg demands it, and a bare
    // weight edit on a non-kg material updates it. An untouched material keeps
    // whatever it had.
    if (dto.unit_id !== undefined || dto.unit_weight_kg !== undefined) {
      product.unitWeightKg = this.resolveUnitWeight(
        product.unitType,
        dto.unit_weight_kg,
        product.unitWeightKg,
      );
    }
    if (dto.is_active !== undefined) product.isActive = dto.is_active;
    product.odooSyncStatus = OdooSyncStatus.PENDING;
    await this.productRepo.save(product);

    if (oldImageUrl) await this.cloudinary.deleteByUrl(oldImageUrl);

    // A basket line snapshots the unit code at add-time, so changing the
    // material's unit would leave every live basket quoting the OLD unit (a
    // line reading "3 PIECE" of a material now sold by KG). Push the new unit
    // into every line that holds this material so the basket and the catalogue
    // never disagree. The name is read live through the product link, so it
    // needs no such push; the price is repriced by the pricing routes.
    if (product.unitType !== prevUnitType) {
      await this.cartItemRepo.update(
        { productId: id },
        { unitType: product.unitType },
      );
    }

    await this.odooSync.enqueueSyncProduct({ productId: id });
    await this.audit.record({
      userId: adminId,
      action: 'UPDATE_PRODUCT',
      entityType: 'product',
      entityId: id,
      newValues: { name: product.name },
    });

    await this.cache.invalidate('products', 'categories', 'offers');

    return { product_id: id, odoo_sync_status: 'PENDING_SYNC' };
  }

  async deleteProduct(adminId: string, id: string) {
    const product = await this.productRepo.findOne({ where: { id } });
    if (!product) throw new ProductNotFoundException();

    const inCart = await this.cartItemRepo.count({ where: { productId: id } });
    if (inCart > 0) {
      throw new ProductInCartsException();
    }

    // A material that has EVER been ordered cannot be hard-deleted.
    //
    // Every order line snapshots what the buyer was charged and keeps a RESTRICT
    // link to the material (order-part-line.entity.ts) — so an order is a
    // permanent receipt, and erasing the material would either tear a hole in
    // that receipt or be refused by the database with a raw constraint error the
    // admin cannot read. Caught here first, the admin is told the deliberate
    // step instead: deactivate the material, which removes it from every buyer's
    // catalogue and basket while leaving it — and its orders — on the record.
    const orderedLines = await this.orderLineRepo.count({ where: { productId: id } });
    if (orderedLines > 0) {
      throw new ProductHasOrdersException();
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

    // Past the three hard blockers (cart, orders, stock) the material has no
    // physical or contractual tie left — so its own catalogue metadata comes
    // down WITH it rather than blocking the delete: the price list (archived to
    // history first), every offer, and every grade. Each grade is safe to drop
    // because the material's whole-warehouse stock is already zero, so none of
    // its grades can be holding any. Placed orders are untouched — every order
    // line froze the code, name and price at checkout. All in one transaction
    // so the material never half-disappears.
    //
    // Order matters: pricing rows carry a RESTRICT link to the grade rows, so
    // prices must go before grades, and the product last.
    await this.dataSource.transaction(async (manager) => {
      const pricingRepo = manager.getRepository(ProductPricing);
      const historyRepo = manager.getRepository(ProductPricingHistory);
      const offerRepo = manager.getRepository(Offer);
      const conditionRepo = manager.getRepository(MaterialCondition);
      const productRepo = manager.getRepository(Product);

      const livePrices = await pricingRepo.find({ where: { productId: id } });
      if (livePrices.length) {
        await historyRepo.save(
          livePrices.map((p) =>
            historyRepo.create({
              productId: p.productId,
              tier: p.tier,
              conditionCode: p.conditionCode,
              price: p.price,
              currency: p.currency,
              effectiveFrom: p.effectiveFrom,
              archivedReason: PricingArchiveReason.DELETED,
              archivedBy: adminId,
            }),
          ),
        );
        await pricingRepo.remove(livePrices);
      }

      await offerRepo.delete({ productId: id });
      await conditionRepo.delete({ productId: id });
      await productRepo.delete(id);
    });

    // Odoo: unlink the product, which cascades its grades and price rows on that
    // side (both are FK ondelete='cascade' to the product there).
    if (product.odooProductId) {
      await this.odooSync.enqueueDeleteProduct({ odooProductId: product.odooProductId });
    }
    await this.audit.record({
      userId: adminId,
      action: 'DELETE_PRODUCT',
      entityType: 'product',
      entityId: id,
      oldValues: { name: product.name },
    });

    await this.cache.invalidate('products', 'categories', 'offers');

    return { message: 'Product deleted successfully' };
  }

  // --- Measurement units ------------------------------------------------------
  // Units are admin-managed (no fixed enum). Products/cart items store the unit
  // `code`; deleting is only allowed while unused — otherwise deactivate.
  async listUnits(query: AdminListQueryDto) {
    const qb = this.unitRepo.createQueryBuilder('u');
    this.applyStatus(qb, 'u', query.status);
    if (query.search) {
      qb.andWhere(
        '(u.code ILIKE :s OR u.nameEn ILIKE :s OR u.nameAr ILIKE :s)',
        { s: `%${query.search}%` },
      );
    }
    qb.orderBy('u.code', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    return {
      units: rows.map((u) => this.mapUnit(u)),
      pagination: buildPagination(total, query.page, query.limit),
    };
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
    // Offers for ONE material.
    if (query.product_id) qb.andWhere('o.productId = :pid', { pid: query.product_id });
    // Offers LIVE on a given date: window contains it. An open-ended offer
    // (`validUntil` null) counts as live from its start.
    if (query.on_date) {
      qb.andWhere('o.validFrom <= :onDate', { onDate: query.on_date }).andWhere(
        '(o.validUntil IS NULL OR o.validUntil > :onDate)',
        { onDate: query.on_date },
      );
    }

    qb.orderBy('o.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    const gradeMap = await this.conditionsService.gradeMapFor([
      ...new Set(rows.map((o) => o.productId)),
    ]);
    return {
      offers: rows.map((o) => this.mapAdminOffer(o, gradeMap)),
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  /**
   * Create an offer — which is one ROW PER AUDIENCE-SHAPE, not one row.
   *
   * The two halves of the buyer base are priced differently, and an offer has
   * to respect that or it cannot be stored at all. Citizens and institutions
   * buy a material at one price; factories and free facilities buy it per
   * GRADE. So an offer aimed at both is genuinely two statements:
   *
   *   "this material is 7 to a citizen"        → one flat row
   *   "its EXCELLENT grade is 9 to a factory"  → one row per grade named
   *
   * Storing that as a single row would force one `condition_code` to mean a
   * grade to one reader and nothing to another, and every query downstream
   * would have to know which. Splitting it here keeps each row true on its own,
   * which is what the read paths, the duplicate check and the Odoo mirror all
   * already assume.
   *
   * All of it in ONE transaction: a graded offer that half-committed would put
   * a price on "excellent" and leave "good" at list, which reads to a buyer as
   * a deliberate decision rather than a failure.
   */
  async createOffer(adminId: string, dto: CreateOfferDto) {
    const product = await this.productRepo.findOne({ where: { id: dto.product_id } });
    if (!product) throw new ProductNotFoundException();

    /**
     * A withdrawn material cannot carry an offer.
     *
     * `isActive = false` means the material is off the shelf: no buyer's
     * catalogue lists it, no basket accepts it, and every price query filters
     * it out. An offer on it would be a discount on something nobody can reach
     * — invisible, unusable, and still sitting in the offers table looking
     * live. Worse, it would come back the instant the material was reactivated,
     * at whatever prices had moved to in the meantime.
     */
    if (!product.isActive) {
      throw new BadRequestException(
        'This material is not active, so it cannot carry an offer. Reactivate the material first.',
      );
    }

    const plan = await this.planOfferRows(dto.product_id, dto);

    for (const row of plan) {
      await this.assertNoDuplicateOffer(dto.product_id, row.conditionCode, row.roles, row.roleSpecific);
    }

    const created = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Offer);
      const rows: Offer[] = [];
      for (const row of plan) {
        rows.push(
          await repo.save(
            repo.create({
              productId: dto.product_id,
              audience: row.audience,
              amount: String(row.amount),
              // Derived, never accepted — see `buildOfferRow`.
              discountPercentage: String(row.percentage ?? 0),
              // The PROMISE, kept so a later price edit knows what to honour.
              basis: row.basis,
              basisPercentage:
                row.basisPercentage == null ? null : String(row.basisPercentage),
              conditionId: row.conditionId,
              conditionCode: row.conditionCode,
              targetRoles: row.roles,
              roleSpecific: row.roleSpecific,
              description: dto.description,
              validFrom: dto.valid_from ? new Date(dto.valid_from) : new Date(),
              validUntil: dto.valid_until ? new Date(dto.valid_until) : undefined,
            }),
          ),
        );
      }
      return rows;
    });

    await this.afterOfferChange(product, adminId, 'CREATE_OFFER', created[0].id, {
      productId: dto.product_id,
      audience: created[0].audience,
      rows: created.map((o) => ({
        condition: o.conditionCode,
        amount: Number(o.amount),
        percentage: Number(o.discountPercentage),
        roles: o.targetRoles,
      })),
    });

    // Tell every account the offer is aimed at. Fire-and-forget: notifying a
    // few hundred buyers must not slow (or fail) the admin's create call.
    void this.notifyOfferAudience(product, created);

    const createdGradeMap = await this.conditionsService.gradeMapFor([product.id]);
    return {
      // The material the offer is on, named — the client no longer has to hold
      // the id it sent just to show "offer on <material>" back to the admin.
      material: { id: product.id, name: product.name },
      offers: created.map((o) => this.mapAdminOffer(o, createdGradeMap)),
      message:
        created.length > 1
          ? `Offer created successfully across ${created.length} lines`
          : 'Offer created successfully',
    };
  }

  /**
   * Notify every account an offer is aimed at that a new offer landed.
   *
   * The target roles come from each created row: its explicit `targetRoles`,
   * or — when the row applies to the whole audience — every role of that
   * audience (`AUDIENCE_ROLES`). Only ACTIVE accounts are told, and each is
   * given the in-app record plus a queued push.
   *
   * Best-effort throughout, and called fire-and-forget: one bad recipient never
   * stops the rest, and a failure here is logged, never surfaced to the admin
   * who created the offer.
   */
  private async notifyOfferAudience(
    product: Product,
    offers: Offer[],
  ): Promise<void> {
    try {
      const roles = new Set<Role>();
      for (const o of offers) {
        const rs =
          o.targetRoles && o.targetRoles.length
            ? (o.targetRoles as Role[])
            : AUDIENCE_ROLES[o.audience as OfferAudience] ?? [];
        for (const r of rs) roles.add(r as Role);
      }
      if (!roles.size) return;

      const accounts = await this.accountRepo.find({
        where: { role: In([...roles]), accountStatus: AccountStatus.ACTIVE },
        select: ['id'],
      });

      for (const acc of accounts) {
        try {
          const notification = await this.notifications.createNotification({
            userId: acc.id,
            type: NotificationType.GENERAL,
            title: 'New offer',
            body: `A new offer is available on ${product.name}.`,
            titleKey: 'notifications.newOffer.title',
            bodyKey: 'notifications.newOffer.body',
            args: { product: product.name },
          });
          await this.notifications.enqueueNotification(notification.id);
        } catch {
          /* one recipient failing must not stop the rest */
        }
      }
    } catch (err) {
      winstonLogger.warn(
        `Offer-audience notification failed for product ${product.id}: ${
          (err as Error).message
        }`,
        { context: 'ADMIN_CATALOG', channel: 'catalog' },
      );
    }
  }

  /**
   * Work out exactly which offer rows this request means, and refuse it whole
   * if any part of it cannot be honoured.
   *
   * The scenario in one paragraph. An offer names a SIDE of the trade and an
   * AMOUNT. Sellers — citizens and institutions — are paid more, so the amount
   * is added to their price. Buyers — factories and free facilities — are
   * charged less, so it comes off theirs. Only buyers are priced per GRADE, so
   * only a buyer offer may name one; a seller is paid before the material is
   * ever sorted, and a grade on their offer describes a distinction their price
   * list does not have.
   *
   * Every refusal below is a case where the offer would otherwise be STORED and
   * then read as something the admin did not intend — which is worse than a
   * rejection, because nothing afterwards looks wrong.
   */
  private async planOfferRows(
    productId: string,
    dto: {
      audience: OfferAudience;
      target_roles?: Role[];
      /** The offer as a share of the price — the ONLY way it is stated. */
      percentage: number;
    },
  ): Promise<OfferPlanRow[]> {
    const audience = dto.audience;
    const roles = await this.resolveAudienceRoles(audience, dto.target_roles);
    const isGraded = await this.conditionsService.hasConditions(productId);
    // Naming role(s) makes this a SPECIFIC offer that may override a general one
    // for those roles; naming none makes it GENERAL. Stamped on every row this
    // request produces.
    const roleSpecific = !!dto.target_roles?.length;
    const plan: OfferPlanRow[] = [];

    // An offer is ALWAYS a percentage now — one figure, fair to every role and
    // every grade it touches, because it is taken against each of their OWN
    // prices. The amount is derived per row and never entered.
    const spec: { percentage: number } = { percentage: dto.percentage };

    // ── SELLERS: a percentage added to each seller's price, never per grade ──
    if (audience === OfferAudience.SELLERS) {
      plan.push(
        ...(await this.buildPerRoleRows(productId, audience, roles, null, null, spec, roleSpecific)),
      );
      return plan;
    }

    // ── BUYERS on an UNGRADED material: one percentage off each buyer's price ──
    if (!isGraded) {
      plan.push(
        ...(await this.buildPerRoleRows(productId, audience, roles, null, null, spec, roleSpecific)),
      );
      return plan;
    }

    // ── BUYERS on a GRADED material ────────────────────────────────────
    //
    // The one percentage applies to EVERY grade, taken against each grade's own
    // price — so "20% off" is a different amount per grade, which is exactly
    // what a share (rather than a flat number) is for. Each grade is still
    // checked separately, so a percentage that would somehow drive one below
    // zero is refused rather than clamped.
    for (const grade of await this.conditionsService.activeForProduct(productId)) {
      plan.push(
        ...(await this.buildPerRoleRows(
          productId, audience, roles, grade.id, grade.code, spec, roleSpecific,
        )),
      );
    }
    return plan;
  }

  /**
   * The roles an offer actually reaches, and the check that they are all on
   * the same side of the trade.
   *
   * Naming no role means BOTH roles of the audience, which is the common case.
   * Naming one from the other side is refused rather than dropped: it would be
   * an increase applied to a price that is supposed to fall, and silently
   * ignoring it would leave the admin believing a role was covered when it was
   * not.
   */
  /**
   * One offer row PER ROLE, each priced from that role's OWN price.
   *
   * A single offer aimed at several roles is several promises, not one. Citizens
   * and institutions can be priced differently for the same material, so "10%
   * off for sellers" is 10% of the CITIZEN price for a citizen and 10% of the
   * INSTITUTION price for an institution — two different amounts. And even a flat
   * "1.5 off" is a different PERCENTAGE for each role, because each starts from a
   * different price.
   *
   * Collapsing the roles into one row with one amount forced a single figure to
   * stand for both, derived from whichever role's price happened to be cheapest —
   * so the other role silently got the wrong discount. Splitting here builds each
   * role against its own price (and, for graded buyers, its own price for the
   * grade), so every role's amount and percentage are true for that role alone.
   */
  private async buildPerRoleRows(
    productId: string,
    audience: OfferAudience,
    roles: Role[],
    conditionId: string | null,
    conditionCode: string | null,
    spec: { amount?: number; percentage?: number },
    roleSpecific = false,
  ): Promise<OfferPlanRow[]> {
    const rows: OfferPlanRow[] = [];
    for (const role of roles) {
      rows.push(
        await this.buildOfferRow(productId, audience, [role], conditionId, conditionCode, spec, roleSpecific),
      );
    }
    return rows;
  }

  private async resolveAudienceRoles(
    audience: OfferAudience,
    requested?: Role[],
  ): Promise<Role[]> {
    const allowed = AUDIENCE_ROLES[audience];
    if (!requested?.length) return [...allowed];

    const strangers = requested.filter((r) => !allowed.includes(r));
    if (strangers.length) {
      throw new BadRequestException(
        `${strangers.join(', ')} ${strangers.length > 1 ? 'are' : 'is'} not part of the ${audience.toLowerCase()} — a ${audience === OfferAudience.SELLERS ? 'seller' : 'buyer'} offer can only name ${allowed.join(' or ')}`,
      );
    }
    return [...new Set(requested)];
  }

  /**
   * One offer row, with its amount checked against every price it will touch.
   *
   * The check is the reason this is not a simple insert. A buyer amount larger
   * than a price does not produce a small number — it produces a NEGATIVE one,
   * which means paying somebody to take the material away. And one row can face
   * two tiers at different prices, so it has to hold for the cheaper of them,
   * not the one the admin happened to be looking at.
   */
  private async buildOfferRow(
    productId: string,
    audience: OfferAudience,
    roles: Role[],
    conditionId: string | null,
    conditionCode: string | null,
    /** Exactly one of these: a fixed amount, or a percentage to derive it from. */
    spec: { amount?: number; percentage?: number },
    roleSpecific = false,
  ): Promise<OfferPlanRow> {
    let dearestBase: number | null = null;
    let cheapestBase: number | null = null;

    const tiers = tiersForAudience(audience, roles);

    // Read every price this row faces BEFORE deciding the amount, because a
    // percentage cannot be turned into one without knowing them.
    const bases: number[] = [];
    for (const tier of tiers) {
      const base = await this.livePriceFor(productId, tier, conditionCode);
      if (base == null) {
        throw new BadRequestException(
          conditionCode
            ? `This material has no live ${tier} price for grade "${conditionCode}", so there is nothing for an offer to move`
            : `This material has no live ${tier} price, so there is nothing for an offer to move`,
        );
      }
      bases.push(base);
      cheapestBase = cheapestBase == null ? base : Math.min(cheapestBase, base);
    }

    /**
     * A percentage becomes an amount against the CHEAPEST price the row faces.
     *
     * One row holds one amount, but it can reach two tiers at different prices
     * — and a percentage of each is a different number. Taking the cheapest
     * makes the smaller of the two, which is the only choice that cannot drive
     * any of them below zero. Deriving from the dearest instead would produce
     * an amount that overshoots the cheaper tier, and the guard below would
     * reject the whole offer with an error about a price the admin never
     * mentioned.
     *
     * The percentage actually delivered is then reported honestly by
     * `offerPercentage` further down, measured against the dearest base — so an
     * offer that comes to 25% for one tier and 21% for another advertises 21%,
     * the figure every targeted role is guaranteed.
     */
    /**
     * A buyer's percentage can never reach 100.
     *
     * At exactly 100 the amount equals the price and the buyer pays nothing;
     * past it the price goes negative, which means paying somebody to take the
     * material away. The amount guard below catches this too, but only after
     * the arithmetic — and it then reports a number the administrator never
     * typed. Refusing the percentage names what they actually entered.
     *
     * Sellers are deliberately exempt: their amount is ADDED, so 150% is a
     * generous rise, not an impossible one.
     */
    if (
      spec.percentage != null &&
      audience === OfferAudience.BUYERS &&
      spec.percentage >= 100
    ) {
      throw new BadRequestException(
        `A buyer offer cannot be ${spec.percentage}% — at 100% the price reaches zero, and beyond it the buyer would be paid to take the material away`,
      );
    }

    const amount =
      spec.amount ??
      amountFromPercentage(cheapestBase ?? 0, spec.percentage as number);

    if (!(amount > 0)) {
      throw new BadRequestException(
        'That percentage comes to nothing against this price — the offer would move it by zero',
      );
    }

    for (const [i, tier] of tiers.entries()) {
      const base = bases[i];
      if (audience === OfferAudience.BUYERS && amount >= base) {
        throw new BadRequestException(
          conditionCode
            ? `An amount of ${amount} is more than the ${tier} price of grade "${conditionCode}" (${base}) — it would take the price to zero or below, which means paying the buyer to take the material`
            : `An amount of ${amount} is more than the ${tier} price (${base}) — it would take the price to zero or below, which means paying the buyer to take the material`,
        );
      }
      dearestBase = dearestBase == null ? base : Math.max(dearestBase, base);
    }

    return {
      conditionId,
      conditionCode,
      amount,
      roles,
      audience,
      // What the admin actually promised, carried through to the row so a later
      // price edit knows whether to keep the amount or recompute it.
      basis: spec.percentage != null ? OfferBasis.PERCENTAGE : OfferBasis.AMOUNT,
      basisPercentage: spec.percentage ?? null,
      roleSpecific,
      // Against the DEAREST base the row faces.
      //
      // The percentage is amount ÷ base, so the bigger the base the smaller the
      // percentage — and the smallest is the one every targeted role is
      // guaranteed to get at least. Taking 45 off prices of 100 and 90 is 45%
      // for one and 50% for the other; advertising 50% promises half the
      // audience a saving they will not receive.
      percentage: offerPercentage(dearestBase ?? 0, amount),
    };
  }


  /** The price in force right now for one tier (and grade, when graded). */
  private async livePriceFor(
    productId: string,
    tier: PricingTier,
    conditionCode: string | null,
  ): Promise<number | null> {
    const row = await this.pricingRepo
      .createQueryBuilder('pp')
      .where('pp.productId = :productId', { productId })
      .andWhere('pp.tier = :tier', { tier })
      .andWhere(
        conditionCode
          ? 'pp.conditionCode = :conditionCode'
          : 'pp.conditionCode IS NULL',
        conditionCode ? { conditionCode } : {},
      )
      .andWhere('pp.effectiveFrom <= NOW()')
      .andWhere('(pp.effectiveUntil IS NULL OR pp.effectiveUntil > NOW())')
      .orderBy('pp.effectiveFrom', 'DESC')
      .getOne();

    return row ? Number(row.price) : null;
  }


  async deleteOffer(adminId: string, id: string) {
    const offer = await this.offerRepo.findOne({ where: { id } });
    if (!offer) throw new OfferNotFoundException();

    await this.offerRepo.delete(id);
    // Odoo learns of it by re-reading the live offers: the deleted one is
    // simply no longer among them, so its line falls back to the list price —
    // the very same path an expiry takes. One behaviour, not two.
    await this.afterOfferChange(
      await this.productOfOffer(offer.productId),
      adminId,
      'DELETE_OFFER',
      id,
      { productId: offer.productId },
    );

    return { message: 'Offer deleted successfully' };
  }

  /**
   * Move an offer's window. Nothing else on it is touched.
   *
   * `valid_until: null` is honoured as "open-ended" rather than treated as
   * absent — an offer that has once had an end date must be able to lose it.
   */
  /**
   * Edit an offer through ONE route: its description, its size (amount OR
   * percentage), and its window — any subset, in a single call.
   *
   * Consolidates the former `/amount` and `/validity` routes. Each rule they
   * enforced is kept:
   *
   *  - amount / percentage are MUTUALLY EXCLUSIVE, and the size is re-validated
   *    through the SAME builder creation uses — an amount raised past a price
   *    makes it NEGATIVE (paying a buyer to take the material), which is caught
   *    here as it is on create;
   *  - the BASIS follows what was sent: an explicit amount freezes the number, a
   *    percentage keeps the ratio as the promise so a later price edit recomputes
   *    the amount;
   *  - `valid_until = null` clears the end date; the window must end after it
   *    starts, and the size + window move together so the offer is never briefly
   *    live at a new size on old dates.
   *
   * The audience and target roles are NOT editable here — that flips which way a
   * price moves and is not part of a routine edit.
   *
   * Placed orders are unaffected: the cart snapshots `unitPrice` when a line is
   * added, so an edit only changes what the NEXT reader is quoted.
   */
  async updateOffer(adminId: string, id: string, dto: UpdateOfferDto) {
    const offer = await this.offerRepo.findOne({ where: { id } });
    if (!offer) throw new OfferNotFoundException();

    const touchesSize = dto.percentage != null;
    const touchesWindow = dto.valid_from !== undefined || dto.valid_until !== undefined;
    const touchesDescription = dto.description !== undefined;
    const touchesActive = dto.is_active !== undefined;
    if (!touchesSize && !touchesWindow && !touchesDescription && !touchesActive) {
      throw new BadRequestException('Send at least one field to update');
    }

    const previous = Number(offer.amount);

    // Size — a PERCENTAGE only, rebuilt through the create-time validator so the
    // same negative-price guard applies. There is no amount input.
    if (touchesSize) {
      const spec = { percentage: dto.percentage as number };
      const rebuilt = await this.buildOfferRow(
        offer.productId,
        offer.audience,
        (offer.targetRoles as Role[] | null)?.length
          ? (offer.targetRoles as Role[])
          : [...AUDIENCE_ROLES[offer.audience]],
        offer.conditionId ?? null,
        offer.conditionCode ?? null,
        spec,
      );
      offer.basis = rebuilt.basis;
      offer.basisPercentage =
        rebuilt.basisPercentage == null ? null : String(rebuilt.basisPercentage);
      offer.amount = String(rebuilt.amount);
      // Re-derived, never carried over: the old percentage described the old
      // amount, and leaving it would advertise a change that no longer happens.
      offer.discountPercentage = String(rebuilt.percentage);
    }

    // Window.
    if (dto.valid_from !== undefined) offer.validFrom = new Date(dto.valid_from);
    if (dto.valid_until !== undefined) {
      offer.validUntil = dto.valid_until ? new Date(dto.valid_until) : undefined;
    }
    if (
      offer.validUntil &&
      new Date(offer.validUntil).getTime() <= new Date(offer.validFrom).getTime()
    ) {
      throw new BadRequestException('The offer must end after it starts');
    }

    // Description.
    if (dto.description !== undefined) offer.description = dto.description;

    // Deactivate / reactivate — the "turn it off without deleting" switch. A
    // deactivated offer is not live, so it leaves every buyer catalogue at once
    // (the reader queries all filter isActive = true) while the admin keeps it.
    if (dto.is_active !== undefined) offer.isActive = dto.is_active;

    const saved = await this.offerRepo.save(offer);
    // Every reader of an offer is cached; an edit that did not clear them would
    // leave the old size / window / text quoted until the cache aged out.
    await this.afterOfferChange(
      await this.productOfOffer(offer.productId),
      adminId,
      'UPDATE_OFFER',
      id,
      {
        previous_amount: previous,
        amount: Number(offer.amount),
        percentage: Number(offer.discountPercentage),
        valid_from: offer.validFrom,
        valid_until: offer.validUntil ?? null,
        description: offer.description ?? null,
      },
    );

    const savedGradeMap = await this.conditionsService.gradeMapFor([saved.productId]);
    return { offer: this.mapAdminOffer(saved, savedGradeMap) };
  }

  /**
   * The timeline of a material's offers — every offer it has carried, filterable
   * by a point or a window in time.
   *
   * The question this answers is "what was on offer for this material on such a
   * date". An offer's life is its validity window, so `on` returns the offers
   * whose window CONTAINS that instant (started on or before it, not yet ended),
   * and `from`/`to` return those whose window OVERLAPS the range. `on` wins when
   * both are given — a single instant is the more specific ask. With no filter
   * the whole timeline comes back, newest window first.
   *
   * It reads the offers table directly rather than an audit log: an offer that
   * still exists carries its own history in `valid_from`/`valid_until`, and that
   * is the record a "which offers on this date" view needs. Deleted offers are
   * gone from both, by design — a withdrawn promotion is not part of what was on
   * offer.
   */
  async offerTimeline(productId: string, query: OfferTimelineQueryDto) {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new ProductNotFoundException();

    const qb = this.offerRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.product', 'p')
      .where('o.productId = :productId', { productId });

    // A RANGE, always — offers whose window overlaps [from, to]: begins on/before
    // `to` and ends after `from`. Either bound may be omitted (open-ended).
    if (query.to) qb.andWhere('o.validFrom <= :to', { to: query.to });
    if (query.from) {
      qb.andWhere('(o.validUntil IS NULL OR o.validUntil > :from)', {
        from: query.from,
      });
    }

    qb.orderBy('o.validFrom', 'DESC')
      .addOrderBy('o.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    const historyGradeMap = await this.conditionsService.gradeMapFor([product.id]);
    return {
      product: { id: product.id, name: product.name },
      filter: {
        from: query.from ?? null,
        to: query.to ?? null,
      },
      offers: rows.map((o) => ({
        ...this.mapAdminOffer(o, historyGradeMap),
        basis: o.basis,
        basis_percentage: o.basisPercentage == null ? null : Number(o.basisPercentage),
        created_at: o.createdAt,
      })),
      pagination: buildPagination(total, query.page, query.limit),
    };
  }

  /**
   * Which material CONDITION an offer applies to — required for some buyers,
   * refused for others.
   *
   * The rule follows how the two kinds of buyer are actually priced. A factory
   * or a free facility buys a GRADE: the same material at "excellent" and at
   * "poor" are different goods at different prices, so an offer that named no
   * grade would silently discount all of them at once. An institution or a
   * citizen buys the material flat — there is one price and nothing for a grade
   * to distinguish — so a condition on their offer describes a distinction
   * their price list does not have, and would be quietly ignored.
   *
   * Ungraded materials are the exception on the first half: a material with no
   * conditions defined has nothing to name, so a factory offer on it is flat
   * too.
   */
  /**
   * Everything that must happen after ANY offer moves.
   *
   * Three things, and the third was missing entirely: no offer operation
   * reached Odoo. The mirror on `recycle.product.condition.price` was refreshed
   * only when a MATERIAL PRICE changed, so an offer created, repriced, expired
   * early or deleted here left the Odoo price sheet showing the old figure —
   * for as long as nobody happened to edit that material's price. The admin
   * looking at Odoo and the buyer looking at the app saw different numbers, and
   * nothing on either screen said so.
   *
   * `enqueueUpdatePricing` is the right carrier because the Odoo sheet holds
   * BOTH numbers per line — list price and offer price — so one job rewrites
   * the pair and cannot leave them disagreeing. It re-reads the live offers, so
   * a delete is expressed by their absence, exactly like an expiry.
   */
  private async afterOfferChange(
    product: Product | null,
    adminId: string,
    action: string,
    entityId: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    await this.cache.invalidate('offers', 'products');
    await this.audit.record({
      userId: adminId,
      action,
      entityType: 'offer',
      entityId,
      newValues: values,
    });
    // A material never mirrored into Odoo has no sheet to correct.
    if (product?.odooProductId) {
      await this.odooSync.enqueueUpdatePricing({ productId: product.id });
    }
  }

  /** The material an offer belongs to — needed to reach its Odoo price sheet. */
  private async productOfOffer(productId: string): Promise<Product | null> {
    return this.productRepo.findOne({ where: { id: productId } });
  }

  private async resolveOfferCondition(
    productId: string,
    condition: string | undefined,
    targetRoles: Role[] | undefined,
  ): Promise<string | null> {
    const roles = targetRoles?.length ? targetRoles : null;
    const gradedRoles = [Role.FACTORY, Role.EXTERNAL_PARTNER];
    const flatRoles = [Role.CITIZEN, Role.INSTITUTIONS];

    // An untargeted offer reaches everyone, so it cannot carry a grade: it
    // would have to mean one thing to a factory and nothing to a citizen.
    const targetsGraded = roles ? roles.some((r) => gradedRoles.includes(r)) : false;
    const targetsFlat = roles ? roles.some((r) => flatRoles.includes(r)) : true;

    if (condition && targetsFlat) {
      throw new BadRequestException(
        roles
          ? 'A condition cannot be set on an offer for institutions or citizens — they are priced per material, not per grade'
          : 'A condition cannot be set on an untargeted offer — it would reach buyers who are not priced per grade',
      );
    }

    if (!condition && targetsGraded && (await this.conditionsService.hasConditions(productId))) {
      throw new BadRequestException(
        'This material is graded — an offer for factories or free facilities must name the condition it applies to',
      );
    }

    if (!condition) return null;
    return this.conditionsService.validateActiveCode(productId, condition);
  }

  /**
   * One live offer per (material, condition, audience).
   *
   * A factory may hold offers on SEVERAL conditions of the same material — that
   * is the point of naming the condition — but two live offers on the SAME
   * condition for the same audience have no defined winner: the reader picks
   * whichever the sort happens to surface, so the price a buyer is quoted
   * depends on nothing they can see.
   */
  private async assertNoDuplicateOffer(
    productId: string,
    conditionCode: string | null,
    targetRoles: Role[] | undefined,
    roleSpecific: boolean,
    excludeOfferId?: string,
  ): Promise<void> {
    const rows = await this.offerRepo.find({
      where: { productId, isActive: true },
    });
    const now = Date.now();
    const roles = targetRoles?.length ? targetRoles : null;

    for (const existing of rows) {
      if (excludeOfferId && existing.id === excludeOfferId) continue;
      if ((existing.conditionCode ?? null) !== conditionCode) continue;
      // An expired offer is not competing with anything.
      if (existing.validUntil && new Date(existing.validUntil).getTime() <= now) continue;

      // A GENERAL offer and a role-SPECIFIC one are allowed to coexist for the
      // same role — the specific overrides the general for that role at read
      // time. So a clash is only a clash at the SAME level: two generals that
      // reach the role, or two specifics on the role. Different levels pass.
      if (existing.roleSpecific !== roleSpecific) continue;

      const existingRoles = existing.targetRoles?.length ? existing.targetRoles : null;
      // Untargeted reaches everyone, so it overlaps with any audience.
      const overlaps =
        !roles || !existingRoles || roles.some((r) => existingRoles.includes(r));
      if (overlaps) {
        throw new ConflictException(
          conditionCode
            ? `A live offer already exists for this material at condition "${conditionCode}" for that audience`
            : 'A live offer already exists for this material for that audience',
        );
      }
    }
  }

  /**
   * An offer, as the admin screen needs to read it.
   *
   * Grouped rather than flat, because the fields answer three different
   * questions and mixing them is what made the old payload hard to act on:
   *
   *   `audience`  — WHO, and which way the price moves for them
   *   `grade`     — WHICH grade, by id and code (buyer offers only)
   *   `effect`    — WHAT it does: the amount, what that is as a percentage,
   *                 and the direction spelled out rather than inferred
   *   `validity`  — WHEN, and whether it is live at this instant
   *
   * `is_live` is computed on read against the clock, not stored: an offer that
   * has simply run out must read as finished the moment it does, without
   * anything having to expire it.
   */
  private mapAdminOffer(
    o: Offer,
    gradeMap: Map<string, { id: string; code: string; name: string; sort_order: number }> = new Map(),
  ) {
    const now = Date.now();
    const started = new Date(o.validFrom).getTime() <= now;
    const notEnded = !o.validUntil || new Date(o.validUntil).getTime() > now;

    return {
      offer_id: o.id,
      // The material as one object — id AND name — not a scattered pair.
      product: { id: o.productId, name: o.product?.name ?? null },

      audience: {
        type: o.audience,
        // Empty target_roles means BOTH roles of the audience — resolved here
        // so the reader never has to know that rule to answer "who sees this?".
        roles: o.targetRoles?.length
          ? o.targetRoles
          : [...AUDIENCE_ROLES[o.audience]],
        // Compared as a SET, not by asking whether the column is empty.
        // Creating an offer for a whole audience stores its roles expanded, so
        // a null-check answered "no, only some of them" for every offer that
        // in fact reached all of them.
        applies_to_all_of_type: AUDIENCE_ROLES[o.audience].every((r) =>
          !o.targetRoles?.length ? true : o.targetRoles.includes(r),
        ),
        // GENERAL (audience-wide) vs role-SPECIFIC. A specific offer overrides a
        // general one for its role, so the admin needs to see which this is.
        scope: o.roleSpecific ? 'SPECIFIC' : 'GENERAL',
      },

      // The grade as the single canonical object every route uses (id, code,
      // name, sort order), or null. Renamed from `grade` to `condition` so it
      // matches the key every other response uses for the same fact.
      condition: ConditionsService.gradeObject(o.productId, o.conditionCode, gradeMap),

      effect: {
        amount: Number(o.amount),
        percentage: Number(o.discountPercentage),
        // Spelled out. "Amount 5" alone cannot say whether a seller is paid
        // five more or a buyer charged five less, and the reader should not
        // have to re-derive it from the audience every time.
        direction:
          o.audience === OfferAudience.SELLERS ? 'INCREASE' : 'DECREASE',
        description:
          o.audience === OfferAudience.SELLERS
            ? `Sellers are paid ${Number(o.amount)} more (${Number(o.discountPercentage)}% above the list price)`
            : `Buyers pay ${Number(o.amount)} less (${Number(o.discountPercentage)}% off the list price)`,
      },

      validity: {
        valid_from: o.validFrom,
        valid_until: o.validUntil ?? null,
        is_active: o.isActive,
        is_live: o.isActive && started && notEnded,
      },

      description: o.description ?? null,
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

  private mapAdminProduct(p: Product, hasPrice?: boolean, hasOffer?: boolean) {
    return {
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      image: p.imageURL ?? null,
      category: p.category ? { id: p.category.id, name: p.category.name } : null,
      // The unit as a LINK, plus its name. The identity is here; the redundant
      // `unit_id`/`unit_type` fields are gone — the unit object already carries
      // the id and the code, so repeating them only invited them to drift.
      unit: p.unit
        ? {
            id: p.unit.id,
            code: p.unit.code,
            name_en: p.unit.nameEn,
            name_ar: p.unit.nameAr,
          }
        : null,
      // Weight of one unit in kg — for delivery capacity. ADMIN-ONLY: it appears
      // here and in no buyer-facing mapper. Null for kg materials (1:1).
      unit_weight_kg: p.unitWeightKg != null ? Number(p.unitWeightKg) : null,
      // Whether the material has a LIVE price for any role right now. Unpriced
      // materials still appear in this admin listing (they are the ones that
      // need pricing) — this flag is what tells them apart from priced ones.
      has_price: hasPrice ?? false,
      // Whether the material carries a LIVE offer right now — the admin's answer
      // to "is this material on offer or not?" without opening the offers list.
      // Same live-window as the buyer sees, so the two never disagree.
      has_offer: hasOffer ?? false,
      is_active: p.isActive,
      odoo_product_id: p.odooProductId ?? null,
      odoo_sync_status: p.odooSyncStatus,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    };
  }

  /**
   * Of the given materials, which have at least one LIVE price row right now
   * (started, not yet ended) — one query, used to stamp `has_price` on a whole
   * page of the admin materials list without an N+1.
   */
  private async livePricedProductIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.pricingRepo
      .createQueryBuilder('pp')
      .select('DISTINCT pp.productId', 'productId')
      .where('pp.productId IN (:...ids)', { ids })
      .andWhere('pp.effectiveFrom <= NOW()')
      .andWhere('(pp.effectiveUntil IS NULL OR pp.effectiveUntil > NOW())')
      .getRawMany<{ productId: string }>();
    return new Set(rows.map((r) => r.productId));
  }

  /**
   * Of the given materials, which carry at least one LIVE offer right now —
   * active, started, and not yet ended. The same live-window definition the
   * buyer catalogue and the offers listing use, so `has_offer` on the admin
   * screen agrees with what a buyer would actually see. One query, no N+1.
   */
  private async liveOfferedProductIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.offerRepo
      .createQueryBuilder('o')
      .select('DISTINCT o.productId', 'productId')
      .where('o.productId IN (:...ids)', { ids })
      .andWhere('o.isActive = true')
      .andWhere('o.validFrom <= NOW()')
      .andWhere('(o.validUntil IS NULL OR o.validUntil > NOW())')
      .getRawMany<{ productId: string }>();
    return new Set(rows.map((r) => r.productId));
  }
  // --- helpers --------------------------------------------------------------
  private applyStatus(qb: any, alias: string, status: 'active' | 'inactive' | 'all') {
    if (status === 'active') qb.andWhere(`${alias}.isActive = true`);
    else if (status === 'inactive') qb.andWhere(`${alias}.isActive = false`);
  }
}
