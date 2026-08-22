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

/** One document as Odoo currently judges it. */
/** One warehouse stop on a delivery trip, as pushed to Odoo. */
export interface DeliveryTripPushStop {
  backend_stop_id: string;
  sequence: number;
  warehouse_odoo_id?: number | null;
  part_ref?: string;
  product_summary?: string;
  distance_to_buyer_km: number;
  latitude?: number | null;
  longitude?: number | null;
  picked_up_at?: string | null;
}

/** A planned delivery trip pushed to Odoo for the driver to run. */
export interface DeliveryTripPushPayload {
  backend_trip_id: string;
  trip_number: string;
  order_number?: string;
  /** The order's backend UUID — Odoo joins the trip's cost onto the order by it. */
  backend_order_id?: string;
  buyer_name?: string;
  origin_warehouse_odoo_id?: number | null;
  truck_odoo_id?: number | null;
  driver_odoo_id?: number | null;
  status: string;
  route_distance_km: number;
  delivery_cost: number;
  currency: string;
  dest_latitude?: number | null;
  dest_longitude?: number | null;
  stops: DeliveryTripPushStop[];
}

export interface OdooDriverRequestImage {
  backendMediaId: string;
  status: 'pending' | 'accepted' | 'rejected';
  /** True once the driver was actually TOLD to replace it. */
  reuploadRequested: boolean;
  /**
   * The file Odoo currently holds.
   *
   * The only thing that tells a REPLACED document apart from one whose
   * rejection this backend never heard about: a re-upload resets the media row
   * to PENDING and clears the request, which is byte-for-byte what a row that
   * was never told anything looks like. The URL is what actually changed.
   */
  url: string | null;
}

/** The manager's move on one shift-change request, as Odoo holds it. */
export interface OdooShiftChangeState {
  backendRequestId: string;
  state: 'pending' | 'processing' | 'accepted' | 'rejected';
  rejectionReason: string | null;
  truckOdooId: number | null;
}

/** Where a warehouse has actually got to on one piece of a buyer's order. */
export interface OdooOrderState {
  odooOrderId: number;
  backendPartId: string;
  state: 'pending' | 'processing' | 'ready' | 'completed' | 'cancelled';
  managerApproval: 'pending' | 'approved' | 'rejected';
  approvalRejectReason: string | null;
  handoverState: 'pending' | 'handed_over';
  handoverType: 'carrier' | 'buyer' | null;
  stockDeducted: boolean;
  invoiceNumber: string | null;
  outputZone: string | null;
}

/** The authoritative decision Odoo holds for one driver request. */
export interface OdooDriverRequestState {
  backendDriverId: string;
  state: 'pending' | 'accepted' | 'rejected' | 'need_changes';
  isBlocked: boolean;
  rejectionReason: string | null;
  warehouseOdooId: number | null;
  shiftOdooId: number | null;
  images: OdooDriverRequestImage[];
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
  // Mutable: the admin can change the Odoo login/password from the backend, and
  // the running connection has to pick the new values up immediately (see
  // updateAdminCredentials) — they are also persisted to .env so a restart keeps
  // working.
  private username: string;
  private password: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.url = this.configService.get<string>('ODOO_URL')!;
    this.db = this.configService.get<string>('ODOO_DB')!;
    this.username = this.configService.get<string>('ODOO_USERNAME')!;
    this.password = this.configService.get<string>('ODOO_PASSWORD')!;
    // NOTE: no ODOO_GROUP_ID. The admin group is resolved at runtime from its
    // stable external id (`base.group_system`) in createAdminUser — a numeric
    // group id changes with every fresh Odoo database, so hard-configuring one
    // meant re-editing .env after every rebuild. The xmlid never changes.
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
    /** Measurement-unit CODE (products.unitType), e.g. 'KG'. */
    unitCode?: string;
  }): Promise<number> {
    // NOTE: no `price` here. `recycle.product` has no single price field — it
    // holds per-tier prices (price_factory / price_free_facility) which are
    // written by the dedicated pricing sync (`replaceConditionPrices`) per
    // condition. Sending `price` made Odoo reject the whole create with
    // "Invalid field 'price' in 'recycle.product'", so every product sync
    // failed and the compensation deleted the product from the backend.
    const payload: Record<string, any> = {
      name: values.name,
      category_id: values.categoryOdooId,
    };
    // Odoo resolves the code against its mirror of `measurement_units`, so a
    // material can only ever carry a unit this backend actually defines.
    // Omitted → Odoo falls back to its default unit rather than failing.
    if (values.unitCode) payload.unit_code = values.unitCode;
    const id = await this.callKw<number>('recycle.product', 'create', [payload]);
    if (!id) throw new InternalServerErrorException('Odoo did not return product id');
    return id;
  }

  async updateProduct(odooId: number, values: Record<string, any>): Promise<void> {
    await this.callKw('recycle.product', 'write', [[odooId], values]);
  }

  /**
   * Reads a product's master fields from Odoo — for the REVERSE sync, where an
   * edit made on the Odoo screen is mirrored back to the backend. Only the
   * fields the backend is willing to accept from Odoo travel (the name); pricing
   * and existence stay the backend's to own.
   */
  async fetchProductInfo(odooId: number): Promise<{ name: string } | null> {
    const rows = await this.callKw<any[]>('recycle.product', 'read', [
      [odooId],
      ['name'],
    ]);
    return rows?.[0] ? { name: rows[0].name } : null;
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
    /** Odoo requires one on creation now — see `_assert_location_given`. */
    address?: string;
    zones?: { name: string; type: string }[];
  }): Promise<number> {
    const payload: Record<string, any> = {
      name: values.name,
      code: values.code,
    };
    if (values.address) payload.address = values.address;
    if (values.latitude != null) payload.latitude = values.latitude;
    if (values.longitude != null) payload.longitude = values.longitude;
    if (values.governorate) {
      // Governorates are a real table on both sides now (`recycle.province`
      // mirrors `provinces`), so the plain name travels as-is: Odoo resolves
      // it against the very list this backend pushed. No key-conversion table
      // to keep in step, and a rename here keeps resolving there.
      payload.province_name = values.governorate;
    }
    if (values.zones?.length) {
      // Odoo One2many "create" commands: (0, 0, {values}) per zone.
      // zone_type is a Selection too — normalise 'RECEIVING' → 'receiving'.
      payload.zone_ids = values.zones.map((z) => [
        0,
        0,
        { name: z.name, zone_type: String(z.type ?? '').toLowerCase() },
      ]);
    }

    const id = await this.callKw<number>('recycle.warehouse', 'create', [payload]);
    if (!id) throw new InternalServerErrorException('Odoo did not return warehouse id');
    return id;
  }

  /**
   * Mirrors a backend-side warehouse edit into Odoo.
   *
   * Only the fields the backend owns travel: name, code and capacity. Location
   * and governorate are edited in Odoo after creation — it is the operational
   * system — and flow back here through SYNC_WAREHOUSE, so sending them from
   * this side would let the two overwrite each other.
   */
  async updateRecycleWarehouse(
    odooWarehouseId: number,
    values: { name?: string; code?: string; capacity?: number },
  ): Promise<void> {
    const payload: Record<string, any> = {};
    if (values.name !== undefined) payload.name = values.name;
    if (values.code !== undefined) payload.code = values.code;
    if (values.capacity !== undefined) payload.capacity = values.capacity;
    if (!Object.keys(payload).length) return;
    await this.callKw('recycle.warehouse', 'write', [[odooWarehouseId], payload]);
  }

  /** Lists warehouses from the custom recycle_warehouse addon. */
  /**
   * Every warehouse Odoo has — INCLUDING the closed ones.
   *
   * Closing a warehouse ARCHIVES it there (`active = False`), and an Odoo
   * search silently drops archived rows unless told otherwise. So this listed
   * only the open sites: a warehouse closed in Odoo was never imported, never
   * refreshed, and the backend went on showing it exactly as it was the day
   * before it shut — which is the one moment its state matters most, because
   * allocation must stop choosing it.
   *
   * `active_test: false` is the whole fix, and it belongs here rather than at
   * the call sites: every caller wants the same answer, and one that forgot
   * would fail in a way nobody could see.
   */
  async fetchWarehouses(): Promise<any[]> {
    return this.callKw<any[]>(
      'recycle.warehouse',
      'search_read',
      [[]],
      {
        fields: ['id', 'name', 'code', 'manager_user_id'],
        context: { active_test: false },
      },
    );
  }

  // ---------------------------------------------------------------------------
  // The Odoo admin account (the res.users the backend connects AS)
  // ---------------------------------------------------------------------------

  /** Reads the CONNECTED admin's res.users record. */
  async getConnectedAdminUser(): Promise<{
    id: number;
    name: string;
    login: string;
    email: string | null;
    phone: string | null;
  } | null> {
    const auth = await this.authenticate();
    const users = await this.callKw<any[]>(
      'res.users',
      'read',
      [[auth.uid], ['name', 'login', 'email', 'phone']],
    );
    const u = users?.[0];
    if (!u) return null;
    return {
      id: u.id ?? auth.uid,
      name: u.name,
      login: u.login,
      // Odoo returns `false` for an empty field — normalise to null.
      email: u.email || null,
      phone: u.phone || null,
    };
  }

  /**
   * Updates the CONNECTED admin's res.users record from the backend.
   *
   * DISPLAY fields only — `name`, `email`, `phone`. `login` and `password` are
   * deliberately NOT writable here: they are the very credentials the backend
   * authenticates to Odoo with (ODOO_USERNAME / ODOO_PASSWORD), so changing them
   * from a request would lock the backend out of Odoo on the next call. Returns
   * the refreshed record.
   */
  async updateConnectedAdminUser(values: {
    name?: string;
    email?: string | null;
    phone?: string | null;
  }): Promise<any> {
    const auth = await this.authenticate();
    const payload: Record<string, unknown> = {};
    if (values.name !== undefined) payload.name = values.name;
    if (values.email !== undefined) payload.email = values.email ?? false;
    if (values.phone !== undefined) payload.phone = values.phone ?? false;
    if (Object.keys(payload).length > 0) {
      await this.callKw('res.users', 'write', [[auth.uid], payload]);
    }
    return this.getConnectedAdminUser();
  }

  /**
   * Creates a NEW Odoo admin user (res.users), so the platform can have MORE THAN
   * ONE admin.
   *
   * Invite model — the backend NEVER handles the new admin's password. It creates
   * the account with admin rights and triggers Odoo's own "reset password" flow,
   * which emails the new admin a link to set their own secret. So no admin
   * password is ever chosen by, sent through, or stored on the backend.
   *
   * Admin rights = the Settings/System group (`base.group_system`), resolved by
   * its EXTERNAL id at call time because the numeric id differs per database.
   * A duplicate login is surfaced by Odoo's own unique constraint and mapped to a
   * clean conflict by the caller.
   */
  async createAdminUser(values: {
    name: string;
    login: string;
    email?: string | null;
    phone?: string | null;
  }): Promise<{ id: number; login: string }> {
    await this.authenticate();

    const groupId = await this.resolveXmlId('base', 'group_system');
    const id = await this.callKw<number>('res.users', 'create', [
      {
        name: values.name,
        login: values.login,
        email: values.email ?? false,
        phone: values.phone ?? false,
        // (6, 0, ids) REPLACES the user's groups with exactly this set.
        // Odoo 19 renamed res.users.groups_id → group_ids (the groups system
        // was refactored); the old name raises "Invalid field 'groups_id'",
        // which is what made every additional-admin creation fail.
        group_ids: [[6, 0, [groupId]]],
      },
    ]);
    if (!id) throw new InternalServerErrorException('Odoo did not return a user id');

    // Send the "set your password" invite. Best-effort: if email/reset is not
    // configured the user still exists and an admin can trigger the reset inside
    // Odoo — the invite step must never fail the creation.
    try {
      await this.callKw('res.users', 'action_reset_password', [[id]]);
    } catch {
      /* invite email not configured — the account is created regardless */
    }

    return { id, login: values.login };
  }

  /** Resolves an Odoo external id (`module.name`) to its numeric record id. */
  private async resolveXmlId(module: string, name: string): Promise<number> {
    const rows = await this.callKw<any[]>(
      'ir.model.data',
      'search_read',
      [[['module', '=', module], ['name', '=', name]], ['res_id']],
      { limit: 1 },
    );
    const resId = rows?.[0]?.res_id;
    if (!resId) {
      throw new InternalServerErrorException(`Odoo external id not found: ${module}.${name}`);
    }
    return resId;
  }

  /**
   * Changes the CONNECTED admin's Odoo login and/or password — the credentials
   * the backend itself authenticates with — and keeps the connection alive.
   *
   * The order is chosen so the backend can never lock itself out silently:
   *   1. write the new login/password to Odoo using the current (still valid)
   *      session;
   *   2. switch the in-memory credentials to the new values;
   *   3. drop the cached session and RE-AUTHENTICATE with the new credentials —
   *      proving they work before anything is persisted;
   *   4. only then write them to `.env`, so a restart uses them too.
   *
   * If the re-authentication fails, the change is reported as failed (and the
   * old in-memory values are restored); if the Odoo write itself fails, nothing
   * changed at all.
   */
  async updateAdminCredentials(input: { login?: string; password?: string }): Promise<void> {
    const payload: Record<string, unknown> = {};
    if (input.login !== undefined) payload.login = input.login;
    if (input.password !== undefined) payload.password = input.password;
    if (Object.keys(payload).length === 0) return;

    const auth = await this.authenticate();
    const oldUsername = this.username;
    const oldPassword = this.password;

    // 1) Write to Odoo with the current session.
    await this.callKw('res.users', 'write', [[auth.uid], payload]);

    // 2) Adopt the new credentials in memory.
    if (input.login !== undefined) this.username = input.login;
    if (input.password !== undefined) this.password = input.password;

    // 3) Force a fresh session and prove the new credentials authenticate.
    await this.clearSession();
    try {
      await this.authenticate();
    } catch (e) {
      // Odoo already changed, but the new values do not authenticate — restore
      // the in-memory values and surface the failure loudly.
      this.username = oldUsername;
      this.password = oldPassword;
      await this.clearSession();
      this.logger.error('Odoo credentials changed but re-authentication failed', e as Error);
      throw new InternalServerErrorException(
        'Odoo credentials were changed but the new ones could not authenticate',
      );
    }

    // 4) Persist to .env so a restart keeps the new credentials.
    this.persistEnvCredentials({
      ...(input.login !== undefined ? { ODOO_USERNAME: input.login } : {}),
      ...(input.password !== undefined ? { ODOO_PASSWORD: input.password } : {}),
    });
  }

  /**
   * Writes the given keys into the project's `.env` (updating an existing line
   * or appending). Best-effort: the running instance already holds the new
   * credentials in memory, so a failure to persist only affects a future
   * restart, and must not fail the request.
   */
  private persistEnvCredentials(updates: Record<string, string>): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require('path');
      const envPath = path.resolve(process.cwd(), '.env');
      let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      for (const [key, value] of Object.entries(updates)) {
        const line = `${key}=${value}`;
        const re = new RegExp(`^${key}=.*$`, 'm');
        content = re.test(content)
          ? content.replace(re, line)
          : content + (content.endsWith('\n') || content === '' ? '' : '\n') + line + '\n';
      }
      fs.writeFileSync(envPath, content, 'utf8');
    } catch (e) {
      this.logger.warn(
        `Could not persist Odoo credentials to .env: ${e instanceof Error ? e.message : e}`,
      );
    }
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

  /**
   * Reads per-warehouse stock lines (recycle.stock) for a warehouse.
   *
   * `reserved_qty` travels with the quantity: the allocator must decide on what
   * is actually FREE, not on the raw quantity, or two orders get promised the
   * same stock and the shortage only surfaces at deduction time.
   */
  async fetchWarehouseInventory(odooWarehouseId: number): Promise<any[]> {
    return this.callKw<any[]>(
      'recycle.stock',
      'search_read',
      [[['warehouse_id', '=', odooWarehouseId]]],
      {
        fields: [
          'product_id',
          'quantity',
          'reserved_qty',
          'available_qty',
          'condition',
        ],
      },
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
      [
        [odooWarehouseId],
        [
          'name',
          'code',
          // Lifecycle: allocation must never choose a warehouse that Odoo has
          // put into closing/inactive.
          'state',
          // Governorate as the backend's own uuid, so the mirror links to a
          // `provinces` row without matching on a display name.
          'province_backend_id',
          'governorate',
          'latitude',
          'longitude',
          // Both editable in Odoo, and both were missing here — so an edit
          // there never reached the mirror. Capacity matters most: the backend
          // reports load as a percentage of it, so the two systems showed
          // different fullness for the same building until somebody called a
          // sync by hand.
          'capacity',
          'address',
          // Shipments live ONLY in Odoo — receiving, weighing and sorting all
          // happen there — so the count travels with the mirror rather than
          // being asked for on every read of a listing.
          'shipment_count',
        ],
      ],
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
  // Governorates (recycle.province)
  // ---------------------------------------------------------------------------
  // This backend owns the governorate list; Odoo mirrors it so a warehouse can
  // point at a real row instead of a hard-coded Selection. Every call is keyed
  // by the backend uuid, which makes each one idempotent — a replayed push
  // after a connection drop updates in place, it never duplicates.

  async upsertProvince(values: {
    id: string;
    name_en: string;
    name_ar: string;
  }): Promise<number> {
    return this.callKw<number>('recycle.province', 'backend_upsert', [
      values.id,
      values.name_en,
      values.name_ar,
    ]);
  }

  /**
   * A province deleted here is ARCHIVED in Odoo, never unlinked: warehouses
   * created while it existed still point at it and that history must survive.
   */
  async archiveProvince(backendProvinceId: string): Promise<void> {
    await this.callKw('recycle.province', 'backend_archive', [backendProvinceId]);
  }

  /**
   * Full replace-in-place of the governorate list. Used by the startup sync and
   * the reconcile cron so a push lost while Odoo was down still converges —
   * anything Odoo holds that is no longer in this list gets archived there.
   */
  async syncAllProvinces(
    provinces: { id: string; name_en: string; name_ar: string }[],
  ): Promise<{ synced: number; archived: number }> {
    return this.callKw('recycle.province', 'backend_sync_all', [provinces]);
  }

  // ---------------------------------------------------------------------------
  // Buyer orders — one Odoo order per WAREHOUSE part
  // ---------------------------------------------------------------------------
  /**
   * Pushes one part of a buyer's order into Odoo as a `recycle.order`.
   *
   * `recycle.order` is bound to a single warehouse, so a buyer order split
   * across three warehouses becomes three of them — each with its own manager,
   * output employee and invoice, reassembled on our side into the one order the
   * buyer sees.
   *
   * Keyed on `part_id` in Odoo, which makes this idempotent: a retry after a
   * timeout finds the existing order instead of making a warehouse prepare the
   * same goods twice.
   */
  async pushOrderPart(payload: {
    part_id: string;
    /**
     * The buyer ORDER these parts belong to, and this part's place in it.
     *
     * A split order is approved by the Odoo administrator as ONE decision —
     * three warehouse managers each approving their own piece leaves the buyer
     * with a half-approved order and nobody responsible for the whole. Odoo
     * cannot group the parts without being told which order they came from.
     */
    order_id?: string;
    part_sequence?: number;
    part_count?: number;
    factory_id?: string;
    customer_name: string;
    owner_name?: string;
    customer_email?: string;
    warehouse_odoo_id: number;
    order_type: 'factory' | 'free_facility';
    lines: {
      product_odoo_id: number;
      quantity: number;
      condition?: string | null;
      price_unit: number;
    }[];
  }): Promise<{ odoo_id: number; created: boolean }> {
    return this.callKw('recycle.order', 'backend_upsert_part', [payload]);
  }

  /** The buyer cancelled — withdraw the part before anyone acts on it. */
  async cancelOrderPart(
    partId: string,
    reason?: string,
  ): Promise<{ cancelled: boolean; reason?: string }> {
    return this.callKw('recycle.order', 'backend_cancel_part', [partId, reason ?? null]);
  }

  /**
   * Reserves this part's stock in Odoo, all-or-nothing.
   *
   * Called the moment a warehouse is chosen and BEFORE its manager is asked:
   * the gap between choosing and approving is exactly where two orders would
   * otherwise be promised the same stock.
   */
  async reserveOrderStock(
    odooOrderId: number,
  ): Promise<{ reserved: boolean; shortages?: unknown[] }> {
    return this.callKw('recycle.order', 'action_reserve_stock', [[odooOrderId]]);
  }

  /**
   * The active driver of a delivery truck, so the backend can dispatch and
   * notify them once it has scored and picked the truck. Returns `{}` when the
   * truck has no active driver — a state to handle, not an error.
   */
  async fetchDeliveryDriverForTruck(odooTruckId: number): Promise<{
    driver_id?: number;
    name?: string;
    phone?: string;
    has_login?: boolean;
  }> {
    return this.callKw(
      'recycle.delivery.driver',
      'backend_driver_for_truck',
      [odooTruckId],
    );
  }

  /**
   * Pushes a planned delivery trip into Odoo for the driver to run. Idempotent
   * on `backend_trip_id`: dispatched once and re-pushed after an edit both land
   * on the same trip, and any pickup the driver already confirmed is kept.
   */
  async pushDeliveryTrip(
    payload: DeliveryTripPushPayload,
  ): Promise<{ ok: boolean; id: number; trip_number: string }> {
    return this.callKw('recycle.delivery.trip', 'backend_upsert', [payload]);
  }

  /**
   * Registers a COLLECTION intake in Odoo: the material the collector actually
   * carried from the producer into the warehouse. Idempotent on `request_id` —
   * a retry after a timeout re-lands on the same intake instead of growing the
   * stock twice. The lines already carry each product's Odoo id, resolved at
   * delivery time (those without one are carried as `null` and Odoo skips them).
   */
  async registerIntake(payload: {
    request_id: string;
    warehouse_odoo_id?: number | null;
    producer_name?: string | null;
    received_at?: string | null;
    lines: { product_odoo_id?: number | null; quantity: number }[];
  }): Promise<{ odoo_id?: number }> {
    return this.callKw('recycle.collection.request', 'backend_register_intake', [payload]);
  }

  /**
   * Notifies a warehouse's manager of a complaint about one of its parts — a
   * shortage or a quality problem, decided from the deduction evidence that
   * lives in Odoo, not here.
   */
  async notifyWarehouseComplaint(payload: {
    odooWarehouseId: number;
    kind: string;
    description: string;
    orderNumber: string;
  }): Promise<{ notified: boolean }> {
    return this.callKw('recycle.warehouse', 'notify_complaint', [
      payload.odooWarehouseId,
      payload.kind,
      payload.description,
      payload.orderNumber,
    ]);
  }

  /**
   * Re-grades UNRESERVED stock of one material between two conditions, INSIDE
   * Odoo, keeping the warehouse total unchanged.
   *
   * Odoo owns the quantities: the backend once moved its own mirror and the next
   * inventory sync overwrote it, reverting the re-grade silently. So the move is
   * made here and the mirror follows the inventory ping this triggers.
   *
   * Returns `transferred:false` (with what WAS movable) instead of raising when
   * the unreserved stock cannot cover the request — a race the caller can report
   * rather than a crash.
   */
  async transferStockGrade(payload: {
    warehouseOdooId: number;
    odooProductId: number;
    fromCondition: string;
    toCondition: string;
    quantity: number;
  }): Promise<{ transferred: boolean; moved?: number; movable?: number; requested?: number }> {
    return this.callKw('recycle.stock', 'transfer_grade', [
      payload.warehouseOdooId,
      payload.odooProductId,
      payload.fromCondition,
      payload.toCondition,
      payload.quantity,
    ]);
  }

  // ---------------------------------------------------------------------------
  // Delivery tariffs (recycle.delivery.tariff) — ODOO IS THE AUTHOR
  // ---------------------------------------------------------------------------
  /**
   * Reads the whole delivery-pricing table. Odoo's administrator owns it (Odoo
   * owns the fleet, so it owns what a delivery costs); the backend only keeps a
   * mirror so a buyer's cart can be quoted from a local read.
   *
   * A full read rather than a diff: the table is tiny and re-reading it is
   * idempotent, so a replayed ping or a missed one both converge.
   */
  async fetchDeliveryTariffs(): Promise<any[]> {
    return this.callKw<any[]>(
      'recycle.delivery.tariff',
      'export_for_backend',
      [],
    );
  }

  // ---------------------------------------------------------------------------
  // Material conditions (recycle.material.condition)
  // ---------------------------------------------------------------------------
  // Admin-managed grades (EXCELLENT/GOOD/...) pushed to Odoo so the sorting UI
  // lists them when the sorter grades processed quantities.

  /**
   * Mirrors ONE grade of ONE material.
   *
   *  is required: a grade belongs to a material, and Odoo's
   * sorting screen must offer only the grades of the material in hand.
   */
  async createMaterialCondition(values: {
    name: string;
    code: string;
    sortOrder: number;
    productOdooId: number;
  }): Promise<number> {
    const id = await this.callKw<number>('recycle.material.condition', 'create', [
      {
        name: values.name,
        code: values.code,
        sort_order: values.sortOrder,
        product_id: values.productOdooId,
      },
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
    // Only DRIVER shifts are mirrored: warehouse-staff shifts belong to Odoo
    // employees and never reach the driver app, so keeping them out of the
    // backend keeps the mirror lean and the driver pickers clean.
    return this.callKw<any[]>('recycle.shift', 'search_read', [[['shift_type', '=', 'driver']]], {
      fields: ['name', 'start_time', 'end_time', 'shift_type', 'is_global', 'warehouse_ids', 'tolerance'],
    });
  }

  async fetchTrucks(): Promise<any[]> {
    return this.callKw<any[]>('recycle.truck', 'search_read', [[]], {
      // `truck_type` travels too: without it the mirror cannot tell a
      // collection truck from a delivery one, and the admin fleet screen lists
      // both with nothing to distinguish them.
      fields: [
        'model',
        'year',
        'plate_number',
        'max_payload_kg',
        // Bed dimensions authored in Odoo, mirrored onto the backend truck row.
        'length_m',
        'width_m',
        'warehouse_id',
        'is_active',
        'truck_type',
      ],
    });
  }

  /**
   * The DELIVERY trucks of one warehouse, read LIVE from Odoo.
   *
   * Delivery trucks are Odoo's to author and are NOT mirrored in the backend —
   * only collection trucks are. So the delivery-trip planner cannot pick one
   * from a local table; it asks Odoo here, at plan time, for the active delivery
   * vehicles stationed at the warehouse a trip departs from. Only the fields the
   * scorer needs travel (id + payload); "busy" and "recent trips" are still
   * derived from the backend's own trip rows, keyed by the Odoo truck id.
   */
  async fetchDeliveryTrucksForWarehouse(odooWarehouseId: number): Promise<any[]> {
    return this.callKw<any[]>(
      'recycle.truck',
      'search_read',
      [
        [
          ['truck_type', '=', 'delivery'],
          ['is_active', '=', true],
          ['warehouse_id', '=', odooWarehouseId],
        ],
      ],
      { fields: ['max_payload_kg', 'plate_number'] },
    );
  }

  /**
   * Which of these delivery trucks have an AVAILABLE driver (active, unblocked)
   * right now — so the scorer can rank a driverless truck last instead of
   * picking it and stalling at dispatch. One call for the whole candidate set.
   */
  async fetchTrucksWithAvailableDriver(odooTruckIds: number[]): Promise<number[]> {
    if (!odooTruckIds.length) return [];
    const ids = await this.callKw<number[]>(
      'recycle.delivery.driver',
      'backend_available_driver_truck_ids',
      [odooTruckIds],
    );
    return (ids ?? []).map((id) => Number(id));
  }

  /**
   * How many DELIVERY trucks Odoo holds right now. The backend mirrors only
   * collection trucks, so the admin's fleet statistics read the delivery figure
   * live from its master rather than from a table it no longer keeps.
   */
  async countDeliveryTrucks(): Promise<number> {
    return this.callKw<number>('recycle.truck', 'search_count', [
      [['truck_type', '=', 'delivery']],
    ]);
  }

  /**
   * DELIVERY trucks grouped by warehouse, read LIVE from Odoo — one call for a
   * whole listing. The backend mirrors only collection trucks, so the admin's
   * per-warehouse fleet screen reads its delivery figures straight from Odoo.
   * Keyed by the ODOO warehouse id; the caller maps those to its own rows.
   */
  async deliveryTruckCountsByWarehouse(): Promise<
    Array<{ odooWarehouseId: number; count: number }>
  > {
    const rows = await this.callKw<any[]>('recycle.truck', 'read_group', [
      [['truck_type', '=', 'delivery']],
      ['warehouse_id'],
      ['warehouse_id'],
    ]);
    return (rows ?? [])
      .map((r) => {
        const wid = Array.isArray(r.warehouse_id) ? r.warehouse_id[0] : r.warehouse_id;
        return { odooWarehouseId: Number(wid), count: Number(r.warehouse_id_count ?? r.__count ?? 0) };
      })
      .filter((r) => Number.isFinite(r.odooWarehouseId) && r.odooWarehouseId > 0);
  }

  async fetchDriverAssignments(): Promise<any[]> {
    return this.callKw<any[]>('recycle.driver.assignment', 'search_read', [[]], {
      fields: ['backend_driver_id', 'truck_id', 'shift_id'],
    });
  }

  /**
   * The backend_driver_id (= collector profile id) of EVERY driver request that
   * currently exists in Odoo. Used by the reconciliation cron to detect which
   * pending drivers never reached Odoo (a push lost to a connection drop) and
   * re-push only those.
   */
  async fetchDriverRequestKeys(): Promise<string[]> {
    const rows = await this.callKw<any[]>('recycle.driver.request', 'search_read', [[]], {
      fields: ['backend_driver_id'],
    });
    return rows.map((r) => r.backend_driver_id).filter(Boolean);
  }

  /**
   * Every catalogue id Odoo currently holds, per model.
   *
   * Used to find ORPHANS — rows that exist in Odoo and correspond to nothing
   * here. The backend is the master for all four of these models, so an Odoo
   * row with no counterpart can only be a deletion that never landed: the
   * delete is enqueued and the local row is removed immediately after, so a job
   * that exhausts its retries leaves the record in Odoo with nothing left on
   * this side to notice it by. Every other drift signal in the system keys off
   * a surviving local row; this one has none, which is why it needs a whole-set
   * comparison instead.
   *
   * Warehouses are deliberately absent: Odoo may legitimately create those
   * itself (the warehouse reconcile adopts them), so an unmatched warehouse is
   * not an orphan.
   */
  async fetchCatalogueIds(): Promise<{
    categories: number[];
    products: number[];
    units: number[];
    conditions: number[];
  }> {
    const ids = async (model: string): Promise<number[]> => {
      const rows = await this.callKw<any[]>(model, 'search_read', [[]], { fields: ['id'] });
      return rows.map((r) => r.id as number);
    };
    return {
      categories: await ids('recycle.product.category'),
      products: await ids('recycle.product'),
      units: await ids('recycle.measurement.unit'),
      conditions: await ids('recycle.material.condition'),
    };
  }

  /**
   * The manager's decision on every shift-change request Odoo knows about.
   *
   * Odoo's `notify_shift_change_status` is STRICT like the driver decisions —
   * it refuses to save a decision the backend did not acknowledge — so the
   * ordinary failure is covered. What is not covered is the same timeout
   * ambiguity: a backend that answers just after Odoo's 8-second window has
   * applied the decision while Odoo rolled it back, and a webhook lost after
   * Odoo committed leaves the driver waiting on an answer that was given.
   */
  async fetchShiftChangeStates(backendRequestIds: string[]): Promise<OdooShiftChangeState[]> {
    if (!backendRequestIds.length) return [];
    const rows = await this.callKw<any[]>(
      'recycle.shift.change.request',
      'search_read',
      [[['backend_request_id', 'in', backendRequestIds]]],
      { fields: ['backend_request_id', 'state', 'rejection_reason', 'truck_id'] },
    );
    return rows
      .filter((r) => r.backend_request_id)
      .map((r) => ({
        backendRequestId: r.backend_request_id as string,
        state: r.state,
        rejectionReason: (r.rejection_reason || null) as string | null,
        truckOdooId: Array.isArray(r.truck_id) ? (r.truck_id[0] as number) : null,
      }));
  }

  /**
   * Where every open order part actually stands in Odoo.
   *
   * Odoo reports each step a warehouse takes (`_notify_backend`) and swallows
   * the failure deliberately, so a warehouse employee is never blocked by an
   * unreachable backend. That is the right call — but it means a lost event is
   * lost for good: the buyer's order sits at "accepted" while the goods are
   * boxed and gone. Unlike the fleet and warehouse mirrors, nothing re-read the
   * orders, so there was no second chance.
   *
   * Only parts that are still moving are fetched — a delivered or cancelled
   * order is finished business and re-reading it every ten minutes for the life
   * of the database buys nothing.
   */
  async fetchOpenOrderStates(partIds: string[]): Promise<OdooOrderState[]> {
    if (!partIds.length) return [];
    const rows = await this.callKw<any[]>(
      'recycle.order',
      'search_read',
      [[['backend_part_id', 'in', partIds]]],
      {
        fields: [
          'backend_part_id',
          'state',
          'manager_approval',
          'approval_reject_reason',
          'handover_state',
          'handover_type',
          'stock_deducted_at',
          'invoice_number',
          'output_zone_id',
        ],
      },
    );
    return rows
      .filter((r) => r.backend_part_id)
      .map((r) => ({
        odooOrderId: r.id as number,
        backendPartId: r.backend_part_id as string,
        state: r.state,
        managerApproval: r.manager_approval,
        approvalRejectReason: (r.approval_reject_reason || null) as string | null,
        handoverState: r.handover_state,
        handoverType: (r.handover_type || null) as OdooOrderState['handoverType'],
        stockDeducted: !!r.stock_deducted_at,
        invoiceNumber: (r.invoice_number || null) as string | null,
        // many2one → [id, display_name]
        outputZone: Array.isArray(r.output_zone_id) ? (r.output_zone_id[1] as string) : null,
      }));
  }

  /**
   * The DECISION Odoo currently holds for every driver request, documents
   * included.
   *
   * `fetchDriverRequestKeys` above answers only "does Odoo know about this
   * driver", which catches a push that never landed. It cannot catch the
   * opposite and worse drift: the request exists in Odoo, the admin decided it,
   * and the decision webhook never reached the backend — so Odoo shows
   * "accepted" while the driver is still waiting in the app. Nothing self-heals
   * that, because the reviewer sees a finished request and never touches it
   * again.
   *
   * Read as two flat search_reads rather than a nested one: Odoo returns
   * one2many fields as bare ids, so the images have to be fetched by their own
   * model anyway, and one extra call is cheaper than N per request.
   */
  async fetchDriverRequestStates(): Promise<OdooDriverRequestState[]> {
    const rows = await this.callKw<any[]>('recycle.driver.request', 'search_read', [[]], {
      fields: [
        'backend_driver_id',
        'state',
        'is_blocked',
        'rejection_reason',
        'warehouse_id',
        'shift_id',
      ],
    });
    if (!rows.length) return [];

    const images = await this.callKw<any[]>(
      'recycle.driver.request.image',
      'search_read',
      [[['request_id', 'in', rows.map((r) => r.id)]]],
      { fields: ['request_id', 'backend_media_id', 'status', 'reupload_requested', 'url'] },
    );

    const byRequest = new Map<number, OdooDriverRequestImage[]>();
    for (const img of images) {
      // Odoo serialises a many2one as [id, display_name].
      const reqId = Array.isArray(img.request_id) ? img.request_id[0] : img.request_id;
      if (!byRequest.has(reqId)) byRequest.set(reqId, []);
      byRequest.get(reqId)!.push({
        backendMediaId: img.backend_media_id,
        status: img.status,
        reuploadRequested: !!img.reupload_requested,
        url: (img.url || null) as string | null,
      });
    }

    return rows
      .filter((r) => r.backend_driver_id)
      .map((r) => ({
        backendDriverId: r.backend_driver_id as string,
        state: r.state as OdooDriverRequestState['state'],
        isBlocked: !!r.is_blocked,
        rejectionReason: (r.rejection_reason || null) as string | null,
        warehouseOdooId: Array.isArray(r.warehouse_id) ? (r.warehouse_id[0] as number) : null,
        shiftOdooId: Array.isArray(r.shift_id) ? (r.shift_id[0] as number) : null,
        images: byRequest.get(r.id) ?? [],
      }));
  }

  /**
   * Pushes a collector's onboarding request so the Odoo admin reviews it
   * there. Called again after every document re-upload — the Odoo model
   * upserts by backend_driver_id (and replaces the images) instead of
   * duplicating.
   */
  async createDriverRequest(values: {
    backendDriverId: string;
    name: string;
    email: string;
    phone?: string | null;
    /** National ID — the Odoo admin verifies it against the uploaded documents. */
    nationalId?: string | null;
    /** Odoo id of the driver shift the collector picked during onboarding —
     * Odoo stores it on the request (shift_id) and the assign-driver-to-truck
     * screen filters drivers by it. */
    shiftOdooId?: number | null;
    /** Location the driver registered. The province NAME is resolved here (the
     * backend owns the provinces table) so Odoo never shows a raw uuid. */
    provinceName?: string | null;
    address?: string | null;
    locationNote?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    /**
     * The documents — WITH the reviewer's judgement on each.
     *
     * The status travels because the push is an UPSERT: Odoo replaces the whole
     * image list every time the driver re-uploads anything. Sending only the
     * files meant every re-upload silently reset the reviewer's verdict on the
     * documents the driver had not touched, so a request with two bad documents
     * became a request with none the moment he fixed the first.
     */
    images?: {
      mediaId: string;
      fileType: string;
      url: string;
      status: string;
      reuploadRequested: boolean;
    }[];
  }): Promise<number> {
    const id = await this.callKw<number>('recycle.driver.request', 'create', [
      {
        backend_driver_id: values.backendDriverId,
        name: values.name,
        email: values.email,
        phone: values.phone ?? false,
        national_id: values.nationalId ?? false,
        shift_odoo_id: values.shiftOdooId ?? false,
        province_name: values.provinceName ?? false,
        address: values.address ?? false,
        location_note: values.locationNote ?? false,
        latitude: values.latitude ?? false,
        longitude: values.longitude ?? false,
        image_ids: (values.images ?? []).map((img) => [
          0,
          0,
          {
            backend_media_id: img.mediaId,
            file_type: img.fileType,
            url: img.url,
            // Odoo's own vocabulary is lower-case, and its "accepted" is this
            // side's "approved".
            status:
              img.status === 'APPROVED'
                ? 'accepted'
                : img.status === 'REJECTED'
                  ? 'rejected'
                  : 'pending',
            reupload_requested: img.reuploadRequested,
          },
        ]),
      },
    ]);
    if (!id) throw new InternalServerErrorException('Odoo did not return driver request id');
    return id;
  }

  /**
   * Pushes a driver's shift-change request so his WAREHOUSE MANAGER decides
   * there (pending → processing → accepted-with-a-truck / rejected). The
   * driver names no truck — only the shift he wants plus a mandatory reason.
   */
  async createShiftChangeRequest(values: {
    backendRequestId: string;
    backendDriverId: string;
    driverName: string;
    /** Shift the driver wants to move INTO (Odoo id). */
    requestedShiftOdooId: number;
    /** Shift he is on today (Odoo id) — shown to the manager for context. */
    currentShiftOdooId?: number | null;
    reason: string;
    /** Scopes the request to the driver's warehouse manager (Odoo id). */
    warehouseOdooId?: number | null;
  }): Promise<number> {
    const id = await this.callKw<number>('recycle.shift.change.request', 'create', [
      {
        backend_request_id: values.backendRequestId,
        backend_driver_id: values.backendDriverId,
        driver_name: values.driverName,
        shift_id: values.requestedShiftOdooId,
        current_shift_id: values.currentShiftOdooId ?? false,
        reason: values.reason,
        warehouse_odoo_id: values.warehouseOdooId ?? false,
      },
    ]);
    if (!id) throw new InternalServerErrorException('Odoo did not return shift-change id');
    return id;
  }

  /**
   * Driver cancelled his still-PENDING request: remove the Odoo mirror too.
   * Server-guarded there (action_backend_cancel unlinks only pending rows) and
   * idempotent — an already-decided or already-deleted request is a no-op.
   */
  async cancelShiftChangeRequest(backendRequestId: string): Promise<void> {
    await this.callKw('recycle.shift.change.request', 'action_backend_cancel', [
      backendRequestId,
    ]);
  }

  /**
   * Creates the Odoo mirror of a truck-handover session on PICKUP. The
   * warehouse manager reads it in his read-only "Driver Attendance" screen.
   */
  async createTruckHandover(values: {
    backendHandoverId: string;
    backendDriverId: string;
    driverName: string;
    truckOdooId?: number | null;
    shiftOdooId?: number | null;
    warehouseOdooId?: number | null;
    workDate: string;
    pickedUpAt: string;
  }): Promise<number> {
    const id = await this.callKw<number>('recycle.truck.handover', 'create', [
      {
        backend_handover_id: values.backendHandoverId,
        backend_driver_id: values.backendDriverId,
        driver_name: values.driverName,
        truck_odoo_id: values.truckOdooId ?? false,
        shift_odoo_id: values.shiftOdooId ?? false,
        warehouse_odoo_id: values.warehouseOdooId ?? false,
        work_date: values.workDate,
        picked_up_at: values.pickedUpAt,
      },
    ]);
    if (!id) throw new InternalServerErrorException('Odoo did not return handover id');
    return id;
  }

  /** Updates the Odoo handover mirror on DROPOFF (idempotent by backend id). */
  async closeTruckHandover(values: {
    backendHandoverId: string;
    droppedOffAt: string;
    dropoffReason?: string | null;
    lateMinutes?: number | null;
  }): Promise<void> {
    await this.callKw('recycle.truck.handover', 'backend_close', [
      values.backendHandoverId,
      values.droppedOffAt,
      values.dropoffReason ?? false,
      values.lateMinutes ?? 0,
    ]);
  }

  /**
   * Fire-and-forget: asks Odoo to notify the driver's warehouse MANAGER about
   * a missed pickup / late dropoff. (The driver himself is notified by the
   * backend over FCM — this covers the Odoo-side manager only.)
   */
  async notifyHandoverAlertManager(values: {
    backendDriverId: string;
    kind: 'MISSED_PICKUP' | 'LATE_DROPOFF';
    shiftName: string;
    lateMinutes?: number | null;
  }): Promise<void> {
    await this.callKw('recycle.truck.handover', 'backend_alert_manager', [
      values.backendDriverId,
      values.kind,
      values.shiftName,
      values.lateMinutes ?? 0,
    ]);
  }

  /**
   * Mirrors a driver's truck-problem report (reason + photo URLs) so the
   * warehouse manager reads it in his dashboard. Read-only there.
   */
  async createTruckProblem(values: {
    backendProblemId: string;
    backendDriverId: string;
    driverName: string;
    reason: string;
    imageUrls: string[];
    truckOdooId?: number | null;
    warehouseOdooId?: number | null;
  }): Promise<number> {
    const id = await this.callKw<number>('recycle.truck.problem', 'create', [
      {
        backend_problem_id: values.backendProblemId,
        backend_driver_id: values.backendDriverId,
        driver_name: values.driverName,
        reason: values.reason,
        truck_odoo_id: values.truckOdooId ?? false,
        warehouse_odoo_id: values.warehouseOdooId ?? false,
        image_ids: values.imageUrls.map((url) => [0, 0, { url }]),
      },
    ]);
    if (!id) throw new InternalServerErrorException('Odoo did not return truck-problem id');
    return id;
  }

  /**
   * Replaces the per-condition price lines of one product+tier in Odoo
   * (model recycle.product.condition.price). Odoo invoices factories and free
   * facilities with these — each condition of a product has its own price.
   *
   * A material with NO conditions is priced once per tier; that row travels
   * with an EMPTY `conditionCode` and Odoo shows it as the material's plain
   * price. Dropping it (as an earlier version did) left such materials with no
   * price at all on the Odoo side.
   */
  /**
   * Replace a material's price sheet for one tier — LIST price plus any live
   * offer on each line.
   *
   * The offer travels alongside the list price rather than replacing it. Odoo
   * shows both, because an offer is a *change* and an administrator opening the
   * price sheet is asking what it was as much as what it is. Overwriting
   * `price` with the discount would also make it the new list price the moment
   * the offer lapsed and this mirror stopped being refreshed.
   *
   * `offerPrice: 0` is the explicit "no live offer" — the field is cleared on
   * every push, so an expired or withdrawn offer disappears here rather than
   * lingering as a discount nobody is honouring.
   */
  async replaceConditionPrices(
    odooProductId: number,
    tier: 'factory' | 'free_facility',
    lines: {
      conditionCode: string | null;
      price: number;
      offerPrice?: number | null;
      offerPercentage?: number | null;
      offerValidUntil?: Date | null;
    }[],
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
          condition_code: l.conditionCode ?? '',
          price: l.price,
          // Always written, including the zero — the rows are recreated on
          // every push, so an offer that has ended must leave no trace.
          offer_price: l.offerPrice ?? 0,
          // Stated rather than left to be derived from two numbers.
          offer_percentage: l.offerPercentage ?? 0,
          offer_valid_until: l.offerValidUntil
            ? l.offerValidUntil.toISOString().slice(0, 19).replace('T', ' ')
            : false,
        })),
      ]);
    }
  }
}
