import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Warehouse } from '@src/warehouse/entities/warehouse.entity';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { OdooSyncService } from './odoo-sync.service';
import {
  OdooDriverDecisionDto,
  OdooInventoryWebhookDto,
  OdooShiftChangeDecisionDto,
} from './dto/odoo-webhook.dto';

/**
 * Inbound push channel from Odoo (server-to-server, no JWT).
 *
 * An Odoo automated action on `recycle.stock` create/write POSTs here, so
 * quantity changes in Odoo warehouses reach the backend mirror within seconds
 * instead of waiting for a manual admin sync. The handler only enqueues the
 * existing SYNC_WAREHOUSE job — the processor owns the RPC/retry logic, and the
 * job itself re-reads Odoo, so bursts of webhooks stay consistent.
 *
 * Authentication: shared secret in the `x-odoo-webhook-secret` header, compared
 * in constant time against ODOO_WEBHOOK_SECRET. Unset secret = endpoint off.
 */
@Controller({ path: 'odoo/webhooks', version: '1' })
export class OdooWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly odooSync: OdooSyncService,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
  ) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('inventory')
  @HttpCode(202)
  async inventoryChanged(
    @Headers('x-odoo-webhook-secret') secret: string | undefined,
    @Body() dto: OdooInventoryWebhookDto,
  ) {
    return this.queueSync(secret, dto);
  }

  /**
   * Same handler under a second route: an Odoo automated action on
   * `recycle.warehouse` (name/code edits) posts here. The SYNC_WAREHOUSE job
   * mirrors both master data and stock lines, so one job serves both events.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('warehouse')
  @HttpCode(202)
  async warehouseChanged(
    @Headers('x-odoo-webhook-secret') secret: string | undefined,
    @Body() dto: OdooInventoryWebhookDto,
  ) {
    return this.queueSync(secret, dto);
  }

  /** Odoo fleet changed (trucks / shifts / driver assignments) → re-mirror it. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('fleet')
  @HttpCode(202)
  async fleetChanged(@Headers('x-odoo-webhook-secret') secret: string | undefined) {
    this.assertAuthorized(secret);
    await this.odooSync.enqueueSyncFleet();
    return { message: 'Fleet sync queued', result: { queued: 1 } };
  }

  /** Odoo admin decided on a driver (collector) request. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('driver-decision')
  @HttpCode(202)
  async driverDecision(
    @Headers('x-odoo-webhook-secret') secret: string | undefined,
    @Body() dto: OdooDriverDecisionDto,
  ) {
    this.assertAuthorized(secret);
    if (dto.approved === undefined && !dto.status) {
      throw new BadRequestException('Either approved or status is required');
    }
    await this.odooSync.enqueueDriverDecision({
      backendDriverId: dto.backend_driver_id,
      approved: dto.approved,
      status: dto.status,
      rejectionReason: dto.rejection_reason,
      truckOdooId: dto.truck_odoo_id,
      shiftOdooId: dto.shift_odoo_id,
    });
    return { message: 'Driver decision queued', result: { queued: 1 } };
  }

  /** Odoo admin decided on a driver's shift-change request. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('shift-change-decision')
  @HttpCode(202)
  async shiftChangeDecision(
    @Headers('x-odoo-webhook-secret') secret: string | undefined,
    @Body() dto: OdooShiftChangeDecisionDto,
  ) {
    this.assertAuthorized(secret);
    await this.odooSync.enqueueShiftChangeDecision({
      requestId: dto.backend_request_id,
      approved: dto.approved,
      rejectionReason: dto.rejection_reason,
    });
    return { message: 'Shift-change decision queued', result: { queued: 1 } };
  }

  private async queueSync(secret: string | undefined, dto: OdooInventoryWebhookDto) {
    this.assertAuthorized(secret);

    const warehouses = await this.warehouseRepo.find({
      where:
        dto.odoo_warehouse_id != null
          ? { odooWarehouseId: dto.odoo_warehouse_id }
          : { odooWarehouseId: Not(IsNull()) },
    });

    if (dto.odoo_warehouse_id != null && warehouses.length === 0) {
      throw new NotFoundException('Unknown Odoo warehouse id');
    }

    for (const warehouse of warehouses) {
      await this.odooSync.enqueueSyncWarehouse({
        warehouseId: warehouse.id,
        jobId: uuidv4(),
      });
    }

    winstonLogger.info(
      `Odoo inventory webhook queued ${warehouses.length} warehouse sync(s)`,
      { context: 'OdooWebhook', channel: 'jobs' },
    );

    return { message: 'Inventory sync queued', result: { queued: warehouses.length } };
  }

  private assertAuthorized(secret: string | undefined): void {
    const expected = this.config.get<string>('ODOO_WEBHOOK_SECRET');
    if (!expected) {
      throw new ServiceUnavailableException('Odoo webhook is not configured');
    }
    const provided = Buffer.from(secret ?? '');
    const wanted = Buffer.from(expected);
    if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
      throw new ForbiddenException('Invalid webhook secret');
    }
  }
}
