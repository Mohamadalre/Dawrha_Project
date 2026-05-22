
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
console.log(response.data);

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

    // إذا Odoo رجع خطأ
    if (response.data?.error) {

      const message =
        response.data.error?.data?.message ||
        response.data.error?.message ||
        'Odoo warehouse creation failed';

      // الاسم مكرر
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

    // إذا الخطأ جاهز (409 مثلاً) لا تغلفه
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
}