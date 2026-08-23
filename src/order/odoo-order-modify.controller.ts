import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArrayNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';
import { timingSafeEqual } from 'crypto';
import { OrderAllocationService } from './providers/order-allocation.service';

class ModifyOptionsDto {
  @IsString()
  backend_order_id!: string;
}

class ApplyModifyDto {
  @IsString()
  backend_order_id!: string;

  /** The warehouse set the admin picked — BACKEND warehouse ids, same size. */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  warehouse_backend_ids!: string[];

  @IsOptional()
  @IsString()
  admin_ref?: string;
}

/**
 * The SPLIT-order modify decision, exposed to the ODOO admin.
 *
 * The allocator's suggestions (same-size warehouse sets that cover the order,
 * nearest first) live in the backend — it holds the province stock and the
 * distances. The Odoo admin decides the split there, so Odoo calls THESE routes
 * server-to-server with the shared secret: one to read the suggestions, one to
 * apply the chosen set. The backend re-plans and re-pushes the parts, so the
 * change flows back into Odoo the same way the original split did.
 *
 * Keyed on `backend_order_id` (the buyer order's id, carried on every Odoo
 * part) — Odoo never needs to know the backend's internal shapes.
 */
@Controller({ path: 'odoo/orders', version: '1' })
export class OdooOrderModifyController {
  constructor(
    private readonly config: ConfigService,
    private readonly allocation: OrderAllocationService,
  ) {}

  /** The algorithm's alternative warehouse sets for a split order. */
  @Post('modification-options')
  @HttpCode(200)
  async options(
    @Headers('x-odoo-webhook-secret') secret: string | undefined,
    @Body() dto: ModifyOptionsDto,
  ) {
    this.assertAuthorized(secret);
    const result = await this.allocation.modificationOptions(dto.backend_order_id);
    return { message: 'Modification options fetched', result };
  }

  /** Apply the admin's chosen warehouse set: re-plan + re-push the parts. */
  @Post('apply-modification')
  @HttpCode(200)
  async apply(
    @Headers('x-odoo-webhook-secret') secret: string | undefined,
    @Body() dto: ApplyModifyDto,
  ) {
    this.assertAuthorized(secret);
    const result = await this.allocation.applyModification(
      dto.backend_order_id,
      dto.warehouse_backend_ids,
    );
    return { message: 'Modification applied', result };
  }

  private assertAuthorized(secret: string | undefined): void {
    const expected = this.config.get<string>('ODOO_WEBHOOK_SECRET');
    if (!expected) {
      throw new ServiceUnavailableException('Odoo webhook is not configured');
    }
    const provided = Buffer.from(secret ?? '');
    const wanted = Buffer.from(expected);
    if (
      provided.length !== wanted.length ||
      !timingSafeEqual(provided, wanted)
    ) {
      throw new ForbiddenException('Invalid webhook secret');
    }
  }
}
