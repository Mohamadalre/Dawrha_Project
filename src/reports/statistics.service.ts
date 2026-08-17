import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { WarehouseState } from '@src/warehouse/enums/warehouse-state.enum';
import { Account } from '@src/user/entities/account.entity';
import { Role } from '@src/user/enums/role.enum';
import { AccountStatus } from '@src/user/enums/account-status.enum';
import { TruckEntity } from '@src/truck/entities/truck.entity';
import { TruckAssignmentEntity } from '@src/truck/entities/truck-assignment.entity';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { WasteCategory } from '@src/waste-management/entities/waste-category.entity';
import { Product } from '@src/waste-management/entities/product.entity';
import { Offer } from '@src/waste-management/entities/offer.entity';
import { ProductSuggestion } from '@src/waste-management/entities/product-suggestion.entity';
import { TruckType } from '@src/truck/enums/truck-type.enum';
import { OdooSyncService } from '@src/odoo-sync/odoo-sync.service';
import { OdooService } from '@src/odoo/odoo.service';

/**
 * Admin-only reporting/statistics. Pure aggregation over existing tables — owns
 * no data of its own, so it stays isolated from the feature modules.
 */
@Injectable()
export class StatisticsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(TruckEntity)
    private readonly truckRepo: Repository<TruckEntity>,
    @InjectRepository(TruckAssignmentEntity)
    private readonly assignmentRepo: Repository<TruckAssignmentEntity>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    @InjectRepository(WasteCategory)
    private readonly categoryRepo: Repository<WasteCategory>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    @InjectRepository(ProductSuggestion)
    private readonly suggestionRepo: Repository<ProductSuggestion>,
    private readonly odooSync: OdooSyncService,
    private readonly odoo: OdooService,
  ) {}

  /** Single payload combining every section — for the admin dashboard. */
  async getOverview() {
    const [accounts, trucks, drivers, warehouses, catalog] = await Promise.all([
      this.getAccountStats(),
      this.getTruckStats(),
      this.getDriverStats(),
      this.getWarehouseStats(),
      this.getCatalogStats(),
    ]);
    return {
      accounts,
      trucks,
      drivers,
      warehouses,
      catalog,
      generated_at: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------
  async getAccountStats() {
    const total = await this.accountRepo.count();

    const roleRows = await this.accountRepo
      .createQueryBuilder('a')
      .select('a.role', 'role')
      .addSelect('COUNT(*)', 'count')
      .groupBy('a.role')
      .getRawMany();

    const byRole: Record<string, number> = {};
    for (const role of Object.values(Role)) byRole[role] = 0;
    for (const row of roleRows) byRole[row.role] = Number(row.count);

    const statusRows = await this.accountRepo
      .createQueryBuilder('a')
      .select('a.accountStatus', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('a.accountStatus')
      .getRawMany();

    const byStatus: Record<string, number> = {};
    for (const row of statusRows) byStatus[row.status] = Number(row.count);

    const verified = await this.accountRepo.count({ where: { isEmailVerified: true } });

    return {
      total,
      by_role: byRole,
      by_status: byStatus,
      verified,
      unverified: total - verified,
    };
  }

  // ---------------------------------------------------------------------------
  // Trucks
  // ---------------------------------------------------------------------------
  /**
   * Fleet counts. Odoo is the fleet MASTER (trucks are authored there and
   * mirrored here), so a refresh from Odoo is queued on every read — the counts
   * returned are the current mirror, and the pull keeps the next read fresh.
   * Best-effort: a queue/Odoo hiccup must never fail the stats.
   *
   * Split by TYPE — collection vs delivery — because they are two fleets doing
   * two different jobs (picking material up from sellers vs. carrying sold goods
   * to buyers) and "how many trucks" is meaningless without saying of which.
   */
  async getTruckStats() {
    try {
      await this.odooSync.enqueueSyncFleet();
    } catch {
      /* stats must not fail because a refresh could not be queued */
    }

    // The mirror holds ONLY collection trucks — delivery trucks are Odoo's to
    // manage and are never stored here. So every mirror figure below (count,
    // assignment, status) is the COLLECTION fleet, and the delivery count is
    // read live from Odoo, its master.
    const collection = await this.truckRepo.count();

    let delivery = 0;
    try {
      delivery = await this.odoo.countDeliveryTrucks();
    } catch {
      /* Odoo unreachable: report the collection fleet the mirror knows for sure,
         and leave delivery at 0 rather than failing the whole dashboard. */
    }

    const assignedRow = await this.assignmentRepo
      .createQueryBuilder('a')
      .select('COUNT(DISTINCT a.truck_id)', 'count')
      .getRawOne();
    const assigned = Number(assignedRow?.count ?? 0);

    const statusRows = await this.truckRepo
      .createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('t.status')
      .getRawMany();
    // Statuses are the collection fleet's — the only trucks whose status this
    // backend tracks (a delivery truck has no backend assignment or shift).
    const byStatus: Record<string, number> = {};
    for (const row of statusRows) byStatus[row.status] = Number(row.count);

    return {
      total: collection + delivery,
      // Assignment and status apply to the collection fleet only.
      assigned_to_drivers: assigned,
      unassigned: collection - assigned,
      by_status: byStatus,
      by_type: {
        collection,
        // Live from Odoo — the backend does not mirror delivery trucks.
        delivery,
      },
      // Collection figures are a mirror kept in step with Odoo; the delivery
      // count is read live from Odoo, which owns the delivery fleet outright.
      source: 'odoo_mirror',
    };
  }

  // ---------------------------------------------------------------------------
  // Drivers (collectors)
  // ---------------------------------------------------------------------------
  async getDriverStats() {
    const total = await this.accountRepo.count({ where: { role: Role.COLLECTOR } });
    const active = await this.accountRepo.count({
      where: { role: Role.COLLECTOR, accountStatus: AccountStatus.ACTIVE },
    });

    // Assignments are 1:1 per driver (unique driver_id), so a plain count is
    // the number of drivers currently holding a truck.
    const assigned = await this.assignmentRepo.count();

    // Collection vs delivery drivers, decided by the TYPE of the truck each is
    // on: a driver is a "collection driver" while assigned to a collection
    // truck and a "delivery driver" while on a delivery truck. An unassigned
    // driver has no type yet, so the two figures need not add up to `total`.
    const typeRows = await this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoin('a.truck', 't')
      .select('t.truckType', 'type')
      .addSelect('COUNT(DISTINCT a.driver_id)', 'count')
      .groupBy('t.truckType')
      .getRawMany();
    const byType: Record<string, number> = { [TruckType.COLLECTION]: 0, [TruckType.DELIVERY]: 0 };
    for (const row of typeRows) byType[row.type] = Number(row.count);

    return {
      total,
      active,
      assigned_to_truck: assigned,
      without_truck: Math.max(total - assigned, 0),
      by_type: {
        collection_drivers: byType[TruckType.COLLECTION] ?? 0,
        delivery_drivers: byType[TruckType.DELIVERY] ?? 0,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Warehouses
  // ---------------------------------------------------------------------------
  async getWarehouseStats() {
    const total = await this.warehouseRepo.count();
    const active = await this.warehouseRepo.count({
      where: { state: Not(WarehouseState.INACTIVE) },
    });
    return { total, active, inactive: total - active };
  }

  // ---------------------------------------------------------------------------
  // Catalogue
  // ---------------------------------------------------------------------------
  async getCatalogStats() {
    const [categories, products, activeProducts, offers, pendingSuggestions] = await Promise.all([
      this.categoryRepo.count(),
      this.productRepo.count(),
      this.productRepo.count({ where: { isActive: true } }),
      this.offerRepo.count(),
      // Suggestions the admin has not answered yet (no status any more — a
      // suggestion is "pending" until it has been replied to).
      this.suggestionRepo.count({ where: { adminReply: IsNull() } }),
    ]);
    return {
      categories,
      products,
      active_products: activeProducts,
      offers,
      pending_suggestions: pendingSuggestions,
    };
  }
}
