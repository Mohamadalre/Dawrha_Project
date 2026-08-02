import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Product } from '@src/waste-management/entities/product.entity';
import { MaterialCondition } from '@src/waste-management/entities/material-condition.entity';
import { MeasurementUnit } from '@src/waste-management/entities/measurement-unit.entity';
import { ConditionsService } from '@src/waste-management/common/providers/conditions.service';
import { UnitsService } from '@src/waste-management/common/providers/units.service';
import { StockStatus } from '@src/waste-management/enums/stock-status.enum';
import { buildPagination } from '@src/waste-management/common/dto/pagination.dto';
import { Warehouse } from '../entities/warehouse.entity';
import { WarehouseInventory } from '../entities/warehouse-inventory.entity';
import { WarehouseNotFoundException } from '../exceptions/warehouse.exceptions';

/** Materials, grades and units the mirror rows refer to, resolved once. */
interface ShapeContext {
  backendIdByOdooId: Map<number | undefined, string>;
  productByOdooId: Map<number | undefined, Product>;
  labels: Map<string, string>;
  /** `${productId}:${CODE}` → the grade row, so responses can carry its id. */
  conditionsByKey: Map<string, MaterialCondition>;
  unitsById: Map<string, MeasurementUnit>;
  unitsByCode: Map<string, MeasurementUnit>;
}

/**
 * A unit as a response carries it: WHICH unit, and nothing else.
 *
 * Id and code only. The NAMES were here too and have been dropped: a stock
 * screen already knows how to render a unit from its code, the two names
 * doubled the size of every totals block, and a caller that wants a label has
 * the units endpoint. `is_weight` and `allows_tolerance` were never here for
 * the same reason — they describe how a unit BEHAVES, which belongs to the
 * units screen.
 *
 * The id is what makes it addressable; the code is what makes it readable.
 */
export interface UnitRef {
  id: string | null;
  code: string;
}

/**
 * Reading stock the way Odoo holds it.
 *
 * Odoo is the only writer of quantities; these rows are a mirror, one per
 * (warehouse, material, grade). Three questions are asked of them and each gets
 * its own route, because answering all three from one endpoint would mean
 * shipping the whole mirror to a screen that wanted one number.
 *
 * The arithmetic matches Odoo's exactly: `available = quantity - reserved`,
 * never the raw quantity. Reserved stock is already promised to an order that
 * has not shipped yet, so counting it as sellable is how the same crate gets
 * sold twice.
 */
@Injectable()
export class InventoryQueryService {
  constructor(
    @InjectRepository(WarehouseInventory)
    private readonly inventoryRepo: Repository<WarehouseInventory>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(MaterialCondition)
    private readonly conditionRepo: Repository<MaterialCondition>,
    private readonly conditions: ConditionsService,
    private readonly units: UnitsService,
  ) {}

  /**
   * One warehouse's stock, a page of MATERIALS at a time.
   *
   * Paging over materials rather than over mirror rows is the whole point: a
   * page cut through the raw rows would hand back half a material's grades and
   * the totals on that card would silently be wrong.
   */
  async listForWarehouse(warehouseId: string, page = 1, limit = 10) {
    const warehouse = await this.warehouseRepo.findOne({
      where: { id: warehouseId },
    });
    if (!warehouse) throw new WarehouseNotFoundException();

    // Materials present in this warehouse, ordered by name, one page of them.
    const pageRows = await this.inventoryRepo
      .createQueryBuilder('i')
      .select('i.odooProductId', 'odooProductId')
      .addSelect('MIN(i.productName)', 'productName')
      .where('i.warehouseId = :warehouseId', { warehouseId })
      .andWhere('i.odooProductId IS NOT NULL')
      .groupBy('i.odooProductId')
      .orderBy('MIN(i.productName)', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<{ odooProductId: number }>();

    const odooIds = pageRows.map((r) => Number(r.odooProductId));
    const rows = odooIds.length
      ? await this.inventoryRepo.find({
          where: { warehouseId, odooProductId: In(odooIds) },
        })
      : [];

    const materials = await this.shape(rows);
    // The summary describes the WAREHOUSE, not the page — an admin reading
    // "3 materials" off page one of nine would be reading a lie.
    const summary = await this.warehouseSummary(warehouseId);

    return {
      message: 'Inventory fetched successfully',
      warehouse: {
        id: warehouse.id,
        name: warehouse.name,
        code: warehouse.code,
      },
      last_sync_from_odoo: warehouse.lastOdooSync ?? null,
      inventory: materials,
      summary,
      pagination: buildPagination(summary.materials_count, page, limit),
    };
  }

  /** One material in one warehouse: what is on the shelf, grade by grade. */
  async forProductInWarehouse(productId: string, warehouseId: string) {
    const [product, warehouse] = await Promise.all([
      this.productRepo.findOne({ where: { id: productId } }),
      this.warehouseRepo.findOne({ where: { id: warehouseId } }),
    ]);
    if (!product) throw new NotFoundException('Material not found');
    if (!warehouse) throw new WarehouseNotFoundException();

    const rows = product.odooProductId
      ? await this.inventoryRepo.find({
          where: { warehouseId, odooProductId: product.odooProductId },
        })
      : [];

    const [material] = await this.shape(rows);
    const totals = material ?? this.emptyTotals();

    return {
      // A ZERO is said out loud rather than left to be inferred.
      //
      // "Stock fetched successfully" beside a quantity of 0 reads as a failed
      // lookup — the admin checks the material id, checks the warehouse, and
      // asks whether the sync is broken. It is none of those: the answer is
      // that this warehouse holds none of it, which is a fact worth being told
      // in the same sentence that reports the fetch worked.
      message:
        totals.quantity > 0
          ? 'Stock fetched successfully'
          : 'Stock fetched successfully — this warehouse holds none of this material',
      product: await this.productHeader(product),
      warehouse: {
        id: warehouse.id,
        name: warehouse.name,
        code: warehouse.code,
      },
      quantity: totals.quantity,
      reserved_quantity: totals.reserved_quantity,
      available: totals.available,
      stock_status: totals.stock_status,
      conditions: totals.conditions,
      last_sync: material?.last_sync ?? warehouse.lastOdooSync ?? null,
    };
  }

  /**
   * One material across EVERY warehouse.
   *
   * Both cuts are returned because the admin asks two different questions of
   * the same stock: "how much of this do we hold" (the grade totals) and "where
   * is it" (the per-warehouse breakdown). Deriving either from the other on the
   * client is how the two drift apart.
   */
  async forProduct(productId: string) {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Material not found');

    const rows = product.odooProductId
      ? await this.inventoryRepo.find({
          where: { odooProductId: product.odooProductId },
        })
      : [];

    const warehouseIds = [...new Set(rows.map((r) => r.warehouseId))];
    const warehouses = warehouseIds.length
      ? await this.warehouseRepo.find({ where: { id: In(warehouseIds) } })
      : [];
    const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

    // Resolved ONCE and reused for every slice below: every row here belongs to
    // the same material, so re-resolving per warehouse would be the same two
    // queries repeated once per warehouse for an answer that cannot differ.
    const ctx = rows.length ? await this.resolve(rows) : null;
    const [overall] = ctx ? this.group(rows, ctx) : [];
    const totals = overall ?? this.emptyTotals();

    const perWarehouse = warehouseIds.map((id) => {
      const [entry] = ctx
        ? this.group(
            rows.filter((r) => r.warehouseId === id),
            ctx,
          )
        : [];
      const w = warehouseById.get(id);
      const shaped = entry ?? this.emptyTotals();
      return {
        warehouse_id: id,
        warehouse_name: w?.name ?? null,
        warehouse_code: w?.code ?? null,
        governorate: w?.governorate ?? null,
        quantity: shaped.quantity,
        reserved_quantity: shaped.reserved_quantity,
        available: shaped.available,
        stock_status: shaped.stock_status,
        conditions: shaped.conditions,
      };
    });

    perWarehouse.sort((a, b) => b.available - a.available);

    return {
      message: 'Stock fetched successfully',
      product: await this.productHeader(product),
      total_quantity: totals.quantity,
      total_reserved: totals.reserved_quantity,
      total_available: totals.available,
      stock_status: totals.stock_status,
      warehouse_count: perWarehouse.length,
      conditions: totals.conditions,
      warehouses: perWarehouse,
    };
  }

  /**
   * Mirror rows → one card per material, with its grades underneath.
   *
   * Labels are looked up by (material, code) pair: the same code means
   * different things for different materials, so a bare code cannot name a
   * grade.
   */
  private async shape(rows: WarehouseInventory[]) {
    if (!rows.length) return [];
    return this.group(rows, await this.resolve(rows));
  }

  /**
   * The materials and grade labels these rows refer to, looked up once.
   *
   * Separated from the grouping so a caller that slices the same rows several
   * ways — forProduct does, once per warehouse — pays for the lookup once
   * instead of once per slice.
   */
  private async resolve(rows: WarehouseInventory[]): Promise<ShapeContext> {
    const odooIds = [
      ...new Set(rows.map((r) => r.odooProductId).filter(Boolean)),
    ] as number[];
    const products = odooIds.length
      ? await this.productRepo.find({ where: { odooProductId: In(odooIds) } })
      : [];
    const productIds = products.map((p) => p.id);

    // The grade ROWS, not only their labels: a caller acting on a grade needs
    // its id, and a bare code cannot name one — the same code means different
    // things for different materials.
    const conditions = productIds.length
      ? await this.conditionRepo.find({ where: { productId: In(productIds) } })
      : [];

    const [unitsById, unitsByCode, labels] = await Promise.all([
      this.units.byId(),
      this.units.byCode(),
      this.conditions.labelMapFor(productIds),
    ]);

    return {
      backendIdByOdooId: new Map(products.map((p) => [p.odooProductId, p.id])),
      productByOdooId: new Map(products.map((p) => [p.odooProductId, p])),
      labels,
      conditionsByKey: new Map(
        conditions.map((c) => [`${c.productId}:${c.code}`, c]),
      ),
      unitsById,
      unitsByCode,
    };
  }

  /**
   * The unit a material is measured in, as a response carries it.
   *
   * Identity and name only. `is_weight`, `allows_tolerance` and the Odoo id
   * describe how a unit BEHAVES; they belong to the units screen, and a stock
   * listing that never acts on them would only be making its own payload
   * harder to read.
   *
   * Resolved by id when the material has the link, and by code otherwise —
   * materials created before the link existed still carry only the code, and a
   * stock screen is not the place to discover that.
   */
  private unitRefOf(product: Product | undefined, ctx: ShapeContext): UnitRef | null {
    if (!product) return null;
    const unit =
      (product.unitId ? ctx.unitsById.get(product.unitId) : undefined) ??
      ctx.unitsByCode.get(product.unitType);
    return {
      id: unit?.id ?? null,
      code: unit?.code ?? product.unitType,
    };
  }

  /** Pure: rows + resolved context → one card per material. */
  private group(rows: WarehouseInventory[], ctx: ShapeContext) {
    const { backendIdByOdooId, productByOdooId, labels } = ctx;

    interface Card {
      product_id: string | null;
      odoo_product_id?: number;
      product_name?: string;
      unit: UnitRef | null;
      quantity: number;
      reserved_quantity: number;
      available: number;
      reorder_level: number;
      stock_status: StockStatus;
      last_sync?: Date | null;
      conditions: {
        condition_id: string | null;
        condition: string;
        quantity: number;
        reserved_quantity: number;
        available: number;
      }[];
    }

    const byProduct = new Map<string, Card>();
    for (const r of rows) {
      const key = String(r.odooProductId);
      const backendProduct = productByOdooId.get(r.odooProductId);
      let card = byProduct.get(key);
      if (!card) {
        card = {
          product_id: backendProduct?.id ?? null,
          odoo_product_id: r.odooProductId,
          product_name: backendProduct?.name ?? r.productName,
          unit: this.unitRefOf(backendProduct, ctx),
          quantity: 0,
          reserved_quantity: 0,
          available: 0,
          reorder_level: r.reorderLevel,
          stock_status: StockStatus.OUT_OF_STOCK,
          last_sync: r.syncedAt ?? null,
          conditions: [],
        };
        byProduct.set(key, card);
      }

      const qty = Number(r.quantity);
      const reserved = Number(r.reservedQuantity);
      const available = Math.max(qty - reserved, 0);
      card.quantity += qty;
      card.reserved_quantity += reserved;
      card.available += available;
      card.reorder_level = Math.max(card.reorder_level, r.reorderLevel);
      if (r.syncedAt && (!card.last_sync || r.syncedAt > card.last_sync)) {
        card.last_sync = r.syncedAt;
      }

      const backendProductId = backendIdByOdooId.get(r.odooProductId);
      const conditionKey = `${backendProductId}:${r.conditionCode}`;
      card.conditions.push({
        // Null for UNGRADED, which is a real state and not a grade: stock that
        // has not been sorted yet, or a material that has no grades at all.
        // There is no row to point at, and inventing one would put an id on
        // the response that nothing else in the system would recognise.
        condition_id: ctx.conditionsByKey.get(conditionKey)?.id ?? null,
        // The CODE only. `condition_label` was here beside it and is gone: the
        // id addresses the grade and the code names it, and the label was a
        // third spelling of the same fact that a caller then had to choose
        // between. Whoever needs it reads the grade by its id.
        condition: r.conditionCode,
        quantity: qty,
        reserved_quantity: reserved,
        available,
      });
    }

    return [...byProduct.values()].map((card) => ({
      ...card,
      quantity: round3(card.quantity),
      reserved_quantity: round3(card.reserved_quantity),
      available: round3(card.available),
      stock_status: stockStatus(card.quantity, card.reorder_level),
      conditions: card.conditions.sort((a, b) =>
        a.condition.localeCompare(b.condition),
      ),
    }));
  }

  /**
   * Warehouse-wide figures, computed in the database rather than in a page.
   *
   * Totals are given PER UNIT, and there is no grand total.
   *
   * There used to be one, and it was arithmetic on things that cannot be
   * added: 400 kg of scrap paper plus 30 car batteries came back as "430".
   * That number is not merely imprecise, it is meaningless — it changes when a
   * material is re-measured in tonnes without a single kilogram moving, and it
   * has no unit anyone could write next to it. An admin reading it would be
   * reading a quantity of nothing.
   *
   * So the answer is one row per unit: how much of the KG-measured stock, how
   * many of the PIECE-measured stock. Materials whose unit is missing are
   * grouped under their stored code rather than dropped — an unlinked material
   * still holds real stock, and hiding it would understate the warehouse.
   */
  private async warehouseSummary(warehouseId: string) {
    const rows = await this.inventoryRepo
      .createQueryBuilder('i')
      .select('i.odooProductId', 'odooProductId')
      .addSelect('SUM(i.quantity)', 'quantity')
      .addSelect('SUM(i.reservedQuantity)', 'reserved')
      .addSelect('MAX(i.reorderLevel)', 'reorder')
      .where('i.warehouseId = :warehouseId', { warehouseId })
      .andWhere('i.odooProductId IS NOT NULL')
      .groupBy('i.odooProductId')
      .getRawMany<{
        odooProductId: number;
        quantity: string;
        reserved: string;
        reorder: string;
      }>();

    const odooIds = rows.map((r) => Number(r.odooProductId));
    const products = odooIds.length
      ? await this.productRepo.find({ where: { odooProductId: In(odooIds) } })
      : [];
    const productByOdooId = new Map(products.map((p) => [p.odooProductId, p]));
    const [unitsById, unitsByCode] = await Promise.all([
      this.units.byId(),
      this.units.byCode(),
    ]);

    interface UnitTotal extends UnitRef {
      materials_count: number;
      total_quantity: number;
      total_reserved: number;
      total_available: number;
    }

    const byUnit = new Map<string, UnitTotal>();
    let critical = 0;

    for (const row of rows) {
      const qty = Number(row.quantity);
      const reserved = Number(row.reserved);
      if (stockStatus(qty, Number(row.reorder)) !== StockStatus.IN_STOCK) {
        critical++;
      }

      const product = productByOdooId.get(Number(row.odooProductId));
      const unit =
        (product?.unitId ? unitsById.get(product.unitId) : undefined) ??
        (product ? unitsByCode.get(product.unitType) : undefined);
      // Keyed by the unit's identity where there is one, and by the raw code
      // otherwise — two materials sharing a dangling code still belong to the
      // same bucket.
      const key = unit?.id ?? `code:${product?.unitType ?? 'UNKNOWN'}`;

      let bucket = byUnit.get(key);
      if (!bucket) {
        bucket = {
          id: unit?.id ?? null,
          code: unit?.code ?? product?.unitType ?? 'UNKNOWN',
          materials_count: 0,
          total_quantity: 0,
          total_reserved: 0,
          total_available: 0,
        };
        byUnit.set(key, bucket);
      }

      bucket.materials_count++;
      bucket.total_quantity += qty;
      bucket.total_reserved += reserved;
      bucket.total_available += Math.max(qty - reserved, 0);
    }

    const totalsByUnit = [...byUnit.values()]
      .map((b) => ({
        ...b,
        total_quantity: round3(b.total_quantity),
        total_reserved: round3(b.total_reserved),
        total_available: round3(b.total_available),
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    return {
      materials_count: rows.length,
      critical_stock_count: critical,
      // Counts of THINGS are still addable across units; quantities are not.
      totals_by_unit: totalsByUnit,
    };
  }

  private async productHeader(product: Product) {
    const [unitsById, unitsByCode] = await Promise.all([
      this.units.byId(),
      this.units.byCode(),
    ]);
    const unit =
      (product.unitId ? unitsById.get(product.unitId) : undefined) ??
      unitsByCode.get(product.unitType);
    return {
      id: product.id,
      name: product.name,
      // The unit as an identity, not a bare code — the same shape the material
      // routes return, so a client does not have to know which endpoint it
      // came from to read it.
      unit: {
        id: unit?.id ?? null,
        code: unit?.code ?? product.unitType,
      },
      odoo_product_id: product.odooProductId ?? null,
      // A material Odoo has never seen cannot hold stock. Saying so beats a
      // bare zero, which reads as "we sold out" rather than "not synced yet".
      synced_with_odoo: product.odooProductId != null,
    };
  }

  private emptyTotals() {
    return {
      quantity: 0,
      reserved_quantity: 0,
      available: 0,
      stock_status: StockStatus.OUT_OF_STOCK,
      conditions: [] as {
        condition_id: string | null;
        condition: string;
        quantity: number;
        reserved_quantity: number;
        available: number;
      }[],
      last_sync: null as Date | null,
    };
  }
}

/** Matches Odoo's three-decimal quantities — floats otherwise show 0.30000000004. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function stockStatus(quantity: number, reorderLevel: number): StockStatus {
  if (quantity <= 0) return StockStatus.OUT_OF_STOCK;
  if (quantity <= reorderLevel) return StockStatus.LOW_STOCK;
  return StockStatus.IN_STOCK;
}
