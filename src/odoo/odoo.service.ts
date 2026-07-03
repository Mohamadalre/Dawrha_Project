
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ConflictException
} from '@nestjs/common';

import { HttpService } from '@nestjs/axios';

import { ConfigService } from '@nestjs/config';

import { firstValueFrom } from 'rxjs';
import { unlink } from 'fs/promises';

@Injectable()
export class OdooService {
  private readonly logger =
    new Logger(OdooService.name);
  
  private readonly url: string;
  private readonly db: string;
  private readonly username: string;
  private readonly password: string;
  private readonly groupId: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.url =
      this.configService.get<string>(
        'ODOO_URL',
      )!;

    this.db =
      this.configService.get<string>(
        'ODOO_DB',
      )!;

    this.username =
      this.configService.get<string>(
        'ODOO_USERNAME',
      )!;

    this.password =
      this.configService.get<string>(
        'ODOO_PASSWORD',
      )!;

    this.groupId =
      this.configService.get<number>(
        'ODOO_GROUP_ID',
      )!;
  }


  async authenticate() {
    try {
      const response =
        await firstValueFrom(
          this.httpService.post(
            `${this.url}/web/session/authenticate`,
            {
              jsonrpc: '2.0',

              params: {
                db: this.db,

                login: this.username,

                password: this.password,
              },
            },
          ),
        );

      const uid =
        response.data.result.uid;

      const sessionId =
        response.headers['set-cookie'];

      if (!uid) {
        throw new Error(
          'Authentication failed',
        );
      }

      return {
        uid,
        sessionId,
      };
    } catch (error) {
      this.logger.error(
        'Authentication failed',
        error,
      );

      throw new InternalServerErrorException(
        'Failed to connect to Odoo',
      );
    }
  }

 

  async findWarehouseByName(name: string): Promise<number | null> {
  const auth = await this.authenticate();

  const response = await firstValueFrom(
    this.httpService.post(
      `${this.url}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        params: {
          model: 'stock.warehouse',
          method: 'search_read',
          args: [
            [
              ['name', '=', name],
              // إذا عندك شركة واحدة فقط خليها 1:
              ['company_id', '=', 1],
            ],
          ],
          kwargs: { fields: ['id', 'name'], limit: 1 },
        },
      },
      {
        headers: { Cookie: auth.sessionId },
      },
    ),
  );

  const rows = response.data?.result ?? [];
  return rows.length ? rows[0].id : null;
}

async createWarehouse(
  name: string,
  code: string,
): Promise<number> {

  try {
    const auth = await this.authenticate();

    const response = await firstValueFrom(
      this.httpService.post(
        `${this.url}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',

          params: {
            model: 'stock.warehouse',

            method: 'create',

            args: [
              {
                name,
                code,
              },
            ],

            kwargs: {},
          },
        },

        {
          headers: {
            Cookie: Array.isArray(auth.sessionId)
              ? auth.sessionId.join('; ')
              : auth.sessionId,
          },
        },
      ),
    );

    if (response.data?.error) {

      const message =
        response.data.error?.data?.message ||
        response.data.error?.message ||
        'Odoo warehouse creation failed';

      if (
        message.includes('must be unique')
      ) {
        throw new ConflictException(
          'Warehouse already exists in Odoo',
        );
      }

      throw new InternalServerErrorException(
        message,
      );
    }

    const id = response.data?.result;

    if (!id) {
      throw new InternalServerErrorException(
        'Odoo did not return warehouse id',
      );
    }

    return id;

  } catch (error) {

    if (
      error instanceof ConflictException ||
      error instanceof InternalServerErrorException
    ) {
      throw error;
    }

    this.logger.error(
      'Create warehouse failed',
      error,
    );

    throw new InternalServerErrorException(
      'Failed to create warehouse in Odoo',
    );
  }
}


async createManager(dto: {
  fullName: string;
  email: string;
  password: string;
  warehouseId: number; // 1. أضفنا هذا الحقل لمعرفة مستودع المدير     // 2. أضفنا هذا الحقل لتمرير ID مجموعة الصلاحيات
}): Promise<number> {
  try {
    const auth = await this.authenticate();

    const response = await firstValueFrom(
      this.httpService.post(
        `${this.url}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          params: {
            model: 'res.users',
            method: 'create',
            args: [
              {
                name: dto.fullName,
                login: dto.email,
                email: dto.email,
                password: dto.password,
                
         
                property_warehouse_id: dto.warehouseId,
                
                groups_id: [[6, 0, [this.groupId]]],
                // ---------------------------
              },
            ],
            kwargs: {},
          },
        },
        {
          headers: {
            Cookie: Array.isArray(auth.sessionId)
              ? auth.sessionId.join('; ')
              : auth.sessionId,
          },
        },
      ),
    );

    // إذا Odoo رجع خطأ
    if (response.data?.error) {
      const msg =
        response.data.error?.data?.message ||
        response.data.error?.message ||
        'Odoo error';
   
      if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('unique')) {
        throw new ConflictException(msg);
      }

      throw new InternalServerErrorException(msg);
    }

    const id = response.data?.result;
    if (!id) {
      throw new InternalServerErrorException('Odoo did not return manager id');
    }

    return id;
  } catch (error) {
    if (error instanceof ConflictException || error instanceof InternalServerErrorException) {
      throw error;
    }
    this.logger.error('Create manager failed', error);
    throw new InternalServerErrorException('Failed to create manager in Odoo');
  }
}



  async deleteUser(
    userId: number,
  ) {
    try {
      const auth =
        await this.authenticate();

      await firstValueFrom(
        this.httpService.post(
          `${this.url}/web/dataset/call_kw/res.users/unlink`,
          {
            jsonrpc: '2.0',

            params: {
              model: 'res.users',

              method: 'unlink',

              args: [[userId]],

              kwargs: {},
            },
          },
          {
            headers: {
              Cookie:
                auth.sessionId,
            },
          },
        ),
      );
    } catch (error) {
      this.logger.error(
        'Delete user failed',
        error,
      );
    }
  }



  async deleteWarehouse(
    warehouseId: number,
  ) {
    try {
      const auth =
        await this.authenticate();

      await firstValueFrom(
        this.httpService.post(
          `${this.url}/web/dataset/call_kw/stock.warehouse/unlink`,
          {
            jsonrpc: '2.0',

            params: {
              model:
                'stock.warehouse',

              method:
                'unlink',

              args: [
                [warehouseId],
              ],

              kwargs: {},
            },
          },
          {
            headers: {
              Cookie:
                auth.sessionId,
            },
          },
        ),
      );
    } catch (error) {
      this.logger.error(
        'Delete warehouse failed',
        error,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Generic JSON-RPC helper + catalogue (category / product) operations
  // ---------------------------------------------------------------------------

  /**
   * Generic Odoo `call_kw` wrapper. Authenticates, performs the call, and
   * surfaces Odoo-side errors as exceptions so callers (Bull jobs) can retry.
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
        {
          headers: {
            Cookie: Array.isArray(auth.sessionId)
              ? auth.sessionId.join('; ')
              : auth.sessionId,
          },
        },
      ),
    );

    if (response.data?.error) {
      const message =
        response.data.error?.data?.message ||
        response.data.error?.message ||
        `Odoo ${model}.${method} failed`;
      throw new InternalServerErrorException(message);
    }

    return response.data?.result as T;
  }

  // NOTE: this backend integrates with the custom `recycle_warehouse` Odoo addon,
  // so all catalogue/warehouse calls target its `recycle.*` models (not the
  // standard product.template / stock.warehouse / stock.quant models).

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
      { fields: ['product_id', 'quantity'] },
    );
  }
}