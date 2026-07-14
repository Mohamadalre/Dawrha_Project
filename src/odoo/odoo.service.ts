import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { RedisService } from '@src/core/redis/redis.service';

interface OdooSession {
  uid: number;
  /** Normalised `Cookie` header value ready to send back on subsequent calls. */
  sessionId: string;
}

/**
 * Thin JSON-RPC client for the custom `recycle_warehouse` Odoo addon. All
 * catalogue/warehouse calls target its `recycle.*` models. Every write from the
 * backend is enqueued (see OdooSyncModule) — this service only performs the RPC.
 *
 * The authenticated session is cached in Redis and reused across calls to avoid
 * re-authenticating on every request; it is cleared whenever Odoo returns an
 * error so the next call transparently re-authenticates (covers session expiry).
 */
@Injectable()
export class OdooService {
  private readonly logger = new Logger(OdooService.name);

  private static readonly SESSION_KEY = 'odoo:session';
  private static readonly SESSION_TTL_SECONDS = 25 * 60; // < Odoo's default session lifetime

  private readonly url: string;
  private readonly db: string;
  private readonly username: string;
  private readonly password: string;
  private readonly groupId: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.url = this.configService.get<string>('ODOO_URL')!;
    this.db = this.configService.get<string>('ODOO_DB')!;
    this.username = this.configService.get<string>('ODOO_USERNAME')!;
    this.password = this.configService.get<string>('ODOO_PASSWORD')!;
    this.groupId = this.configService.get<number>('ODOO_GROUP_ID')!;
  }

  // ---------------------------------------------------------------------------
  // Session handling
  // ---------------------------------------------------------------------------
  async authenticate(): Promise<OdooSession> {
    const cached = await this.redisService.getRedisByKey(OdooService.SESSION_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as OdooSession;
      } catch {
        // Corrupt cache entry — fall through and re-authenticate.
      }
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.url}/web/session/authenticate`, {
          jsonrpc: '2.0',
          params: { db: this.db, login: this.username, password: this.password },
        }),
      );

      const uid = response.data?.result?.uid;
      if (!uid) {
        throw new Error('Authentication failed');
      }

      const rawCookie = response.headers['set-cookie'];
      const sessionId = Array.isArray(rawCookie)
        ? rawCookie.join('; ')
        : (rawCookie ?? '');

      const session: OdooSession = { uid, sessionId };
      await this.redisService.setRedisKey({
        redisKey: OdooService.SESSION_KEY,
        redisValue: JSON.stringify(session),
        date: OdooService.SESSION_TTL_SECONDS,
      });
      return session;
    } catch (error) {
      this.logger.error('Authentication failed', error as Error);
      throw new InternalServerErrorException('Failed to connect to Odoo');
    }
  }

  /** Drops the cached session so the next call re-authenticates. */
  private async clearSession(): Promise<void> {
    await this.redisService.clearByKey(OdooService.SESSION_KEY);
  }

  /**
   * Generic Odoo `call_kw` wrapper. Authenticates (cached), performs the call,
   * and surfaces Odoo-side errors as exceptions so callers (Bull jobs) can retry.
   */
  private async callKw<T = any>(
    model: string,
    method: string,
    args: any[],
    kwargs: Record<string, any> = {},
  ): Promise<T> {
    const auth = await this.authenticate();

    const response = await firstValueFrom(
      this.httpService.post(
        `${this.url}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          params: { model, method, args, kwargs },
        },
        { headers: { Cookie: auth.sessionId } },
      ),
    );

    if (response.data?.error) {
      // Force a fresh session next time (covers an expired/invalid session).
      await this.clearSession();
      const message =
        response.data.error?.data?.message ||
        response.data.error?.message ||
        `Odoo ${model}.${method} failed`;
      throw new InternalServerErrorException(message);
    }

    return response.data?.result as T;
  }

  // ---------------------------------------------------------------------------
  // Catalogue (category / product)
  // ---------------------------------------------------------------------------
  async createProductCategory(name: string): Promise<number> {
    const id = await this.callKw<number>('recycle.product.category', 'create', [{ name }]);
    if (!id) throw new InternalServerErrorException('Odoo did not return category id');
    return id;
  }

  async updateProductCategory(odooId: number, values: Record<string, any>): Promise<void> {
    await this.callKw('recycle.product.category', 'write', [[odooId], values]);
  }

  async deleteProductCategory(odooId: number): Promise<void> {
    await this.callKw('recycle.product.category', 'unlink', [[odooId]]);
  }

  async createProduct(values: {
    name: string;
    categoryOdooId: number;
    price?: number;
  }): Promise<number> {
    const payload: Record<string, any> = {
      name: values.name,
      category_id: values.categoryOdooId,
      price: values.price ?? 0,
    };
    const id = await this.callKw<number>('recycle.product', 'create', [payload]);
    if (!id) throw new InternalServerErrorException('Odoo did not return product id');
    return id;
  }

  async updateProduct(odooId: number, values: Record<string, any>): Promise<void> {
    await this.callKw('recycle.product', 'write', [[odooId], values]);
  }

  async deleteProduct(odooId: number): Promise<void> {
    await this.callKw('recycle.product', 'unlink', [[odooId]]);
  }

  // ---------------------------------------------------------------------------
  // Warehouses (recycle.warehouse)
  // ---------------------------------------------------------------------------
  /**
   * Creates a warehouse in the custom recycle_warehouse addon (recycle.warehouse)
   * together with its zones. Warehouses are authored in the backend and pushed
   * here; the admin only assigns a manager inside Odoo afterwards.
   */
  async createRecycleWarehouse(values: {
    name: string;
    code: string;
    latitude?: number;
    longitude?: number;
    governorate?: string;
    zones?: { name: string; type: string }[];
  }): Promise<number> {
    const payload: Record<string, any> = {
      name: values.name,
      code: values.code,
    };
    if (values.latitude != null) payload.latitude = values.latitude;
    if (values.longitude != null) payload.longitude = values.longitude;
    if (values.governorate) payload.governorate = values.governorate;
    if (values.zones?.length) {
      // Odoo One2many "create" commands: (0, 0, {values}) per zone.
      payload.zone_ids = values.zones.map((z) => [
        0,
        0,
        { name: z.name, zone_type: z.type },
      ]);
    }

    const id = await this.callKw<number>('recycle.warehouse', 'create', [payload]);
    if (!id) throw new InternalServerErrorException('Odoo did not return warehouse id');
    return id;
  }

  /** Lists warehouses from the custom recycle_warehouse addon. */
  async fetchWarehouses(): Promise<any[]> {
    return this.callKw<any[]>(
      'recycle.warehouse',
      'search_read',
      [[]],
      { fields: ['id', 'name', 'code', 'manager_user_id'] },
    );
  }

  /** Reads the manager (res.users) assigned to a recycle.warehouse. */
  async fetchWarehouseManager(odooWarehouseId: number): Promise<any | null> {
    const warehouses = await this.callKw<any[]>(
      'recycle.warehouse',
      'read',
      [[odooWarehouseId], ['manager_user_id']],
    );
    const managerRef = warehouses?.[0]?.manager_user_id;
    const managerId = Array.isArray(managerRef) ? managerRef[0] : managerRef;
    if (!managerId) return null;

    const users = await this.callKw<any[]>(
      'res.users',
      'read',
      [[managerId], ['name', 'login', 'email', 'phone']],
    );
    return users?.[0] ?? null;
  }

  /** Reads per-warehouse stock lines (recycle.stock) for a warehouse. */
  async fetchWarehouseInventory(odooWarehouseId: number): Promise<any[]> {
    return this.callKw<any[]>(
      'recycle.stock',
      'search_read',
      [[['warehouse_id', '=', odooWarehouseId]]],
      { fields: ['product_id', 'quantity', 'condition_code'] },
    );
  }

  /**
   * Reads the master data of one recycle.warehouse so Odoo-side edits (name,
   * code, ...) are mirrored back during SYNC_WAREHOUSE.
   */
  async fetchWarehouseInfo(odooWarehouseId: number): Promise<any | null> {
    const rows = await this.callKw<any[]>(
      'recycle.warehouse',
      'read',
      [[odooWarehouseId], ['name', 'code']],
    );
    return rows?.[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Measurement units (recycle.measurement.unit)
  // ---------------------------------------------------------------------------
  // The Odoo warehouse addon consumes `allows_tolerance` during sorting: when
  // true the sorter's processed quantity may deviate from the shipment's
  // declared quantity; when false they must match exactly.

  async createMeasurementUnit(values: {
    name: string;
    code: string;
    allowsTolerance: boolean;
  }): Promise<number> {
    const id = await this.callKw<number>('recycle.measurement.unit', 'create', [
      { name: values.name, code: values.code, allows_tolerance: values.allowsTolerance },
    ]);
    if (!id) throw new InternalServerErrorException('Odoo did not return unit id');
    return id;
  }

  async updateMeasurementUnit(odooId: number, values: Record<string, any>): Promise<void> {
    await this.callKw('recycle.measurement.unit', 'write', [[odooId], values]);
  }

  async deleteMeasurementUnit(odooId: number): Promise<void> {
    await this.callKw('recycle.measurement.unit', 'unlink', [[odooId]]);
  }

  // ---------------------------------------------------------------------------
  // Material conditions (recycle.material.condition)
  // ---------------------------------------------------------------------------
  // Admin-managed grades (EXCELLENT/GOOD/...) pushed to Odoo so the sorting UI
  // lists them when the sorter grades processed quantities.

  async createMaterialCondition(values: {
    name: string;
    code: string;
    sortOrder: number;
  }): Promise<number> {
    const id = await this.callKw<number>('recycle.material.condition', 'create', [
      { name: values.name, code: values.code, sort_order: values.sortOrder },
    ]);
    if (!id) throw new InternalServerErrorException('Odoo did not return condition id');
    return id;
  }

  async updateMaterialCondition(odooId: number, values: Record<string, any>): Promise<void> {
    await this.callKw('recycle.material.condition', 'write', [[odooId], values]);
  }

  async deleteMaterialCondition(odooId: number): Promise<void> {
    await this.callKw('recycle.material.condition', 'unlink', [[odooId]]);
  }

  // ---------------------------------------------------------------------------
  // Fleet (Odoo is the MASTER: trucks / shifts / driver assignments live there;
  // the backend keeps a read mirror so the driver app endpoints keep working)
  // ---------------------------------------------------------------------------
  async fetchShifts(): Promise<any[]> {
    return this.callKw<any[]>('recycle.shift', 'search_read', [[]], {
      fields: ['name', 'start_time', 'end_time'],
    });
  }

  async fetchTrucks(): Promise<any[]> {
    return this.callKw<any[]>('recycle.truck', 'search_read', [[]], {
      fields: ['model', 'year', 'plate_number', 'max_payload_kg', 'warehouse_id', 'is_active'],
    });
  }

  async fetchDriverAssignments(): Promise<any[]> {
    return this.callKw<any[]>('recycle.driver.assignment', 'search_read', [[]], {
      fields: ['backend_driver_id', 'truck_id', 'shift_id'],
    });
  }

  /** Pushes a collector's onboarding request so the Odoo admin reviews it there. */
  async createDriverRequest(values: {
    backendDriverId: string;
    name: string;
    email: string;
    phone?: string | null;
  }): Promise<number> {
    const id = await this.callKw<number>('recycle.driver.request', 'create', [
      {
        backend_driver_id: values.backendDriverId,
        name: values.name,
        email: values.email,
        phone: values.phone ?? false,
      },
    ]);
    if (!id) throw new InternalServerErrorException('Odoo did not return driver request id');
    return id;
  }

  /** Pushes a driver's shift-change request so the Odoo admin decides there. */
  async createShiftChangeRequest(values: {
    backendRequestId: string;
    backendDriverId: string;
    driverName: string;
    truckOdooId?: number | null;
    shiftOdooId?: number | null;
  }): Promise<number> {
    const id = await this.callKw<number>('recycle.shift.change.request', 'create', [
      {
        backend_request_id: values.backendRequestId,
        backend_driver_id: values.backendDriverId,
        driver_name: values.driverName,
        truck_id: values.truckOdooId ?? false,
        shift_id: values.shiftOdooId ?? false,
      },
    ]);
    if (!id) throw new InternalServerErrorException('Odoo did not return shift-change id');
    return id;
  }

  /**
   * Replaces the per-condition price lines of one product+tier in Odoo
   * (model recycle.product.condition.price). Odoo invoices factories and free
   * facilities with these — each condition of a product has its own price.
   */
  async replaceConditionPrices(
    odooProductId: number,
    tier: 'factory' | 'free_facility',
    lines: { conditionCode: string; price: number }[],
  ): Promise<void> {
    const existing = await this.callKw<number[]>(
      'recycle.product.condition.price',
      'search',
      [[['product_id', '=', odooProductId], ['tier', '=', tier]]],
    );
    if (existing?.length) {
      await this.callKw('recycle.product.condition.price', 'unlink', [existing]);
    }
    if (lines.length) {
      await this.callKw('recycle.product.condition.price', 'create', [
        lines.map((l) => ({
          product_id: odooProductId,
          tier,
          condition_code: l.conditionCode,
          price: l.price,
        })),
      ]);
    }
  }
}
