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
  OdooOrderEventDto,
  OdooShiftChangeDecisionDto,
} from './dto/odoo-webhook.dto';
import { SuggestionsService } from '@src/waste-management/suggestions/suggestions.service';
import { OdooSuggestionDto } from '@src/waste-management/suggestions/dto/odoo-suggestion.dto';

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
    private readonly suggestions: SuggestionsService,
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

  /**
   * REVERSE product sync: a product's master field (its name) was edited on the
   * Odoo screen. Odoo posts the product's own id here and the job mirrors the
   * change back — the backend stays the master for a product's existence and its
   * pricing, this only keeps the shared name from drifting. Ignored quietly when
   * the id is absent (a malformed automated action must not 500 the Odoo write).
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('products')
  @HttpCode(202)
  async productChanged(
    @Headers('x-odoo-webhook-secret') secret: string | undefined,
    @Body() body: { odoo_product_id?: number },
  ) {
    this.assertAuthorized(secret);
    const odooProductId = Number(body?.odoo_product_id);
    if (Number.isInteger(odooProductId) && odooProductId > 0) {
      await this.odooSync.enqueueSyncProductFromOdoo({ odooProductId });
      return { message: 'Product mirror queued', result: { queued: 1 } };
    }
    return { message: 'Ignored — no product id', result: { queued: 0 } };
  }

  /**
   * A warehouse acted on one part of a buyer's order.
   *
   * This route was the missing half of the ordering flow: Odoo has always
   * posted here after completing an order, and nothing was listening — so every
   * order a warehouse finished vanished, and the buyer was never told.
   *
   * Orders created inside Odoo carry no `part_id` and are accepted-and-ignored:
   * they belong to no buyer order here, and rejecting them would fill Odoo's
   * logs with failures for a perfectly legitimate internal workflow.
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('orders')
  @HttpCode(202)
  async orderEvent(
    @Headers('x-odoo-webhook-secret') secret: string | undefined,
    @Body() dto: OdooOrderEventDto,
  ) {
    this.assertAuthorized(secret);
    if (!dto.part_id) {
      return { message: 'Ignored — not part of a buyer order', result: { queued: 0 } };
    }
    await this.odooSync.enqueueOrderEvent({
      partId: dto.part_id,
      odooOrderId: dto.odoo_id,
      event: dto.event,
      invoiceNumber: dto.invoice_number,
      outputZone: dto.output_zone,
      handoverType: dto.handover_type,
      rejectReason: dto.approval_reject_reason,
      warehouseOdooId: dto.warehouse_odoo_id,
    });
    return { message: 'Order event queued', result: { queued: 1 } };
  }

  /**
   * The Odoo administrator changed delivery pricing → re-mirror it.
   *
   * Payload-less on purpose (same shape as the fleet ping): the job re-reads the
   * whole tariff table from Odoo, so a duplicated or replayed ping is harmless
   * and no diff can be applied half-way.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('delivery-tariffs')
  @HttpCode(202)
  async deliveryTariffsChanged(
    @Headers('x-odoo-webhook-secret') secret: string | undefined,
  ) {
    this.assertAuthorized(secret);
    await this.odooSync.enqueueSyncDeliveryTariffs();
    return { message: 'Delivery tariff sync queued', result: { queued: 1 } };
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
      warehouseOdooId: dto.warehouse_odoo_id,
      warehouseChangeOnly: dto.warehouse_change_only,
      rejectedMediaIds: dto.rejected_media_ids,
      documentsOnly: dto.documents_only,
      requestReupload: dto.request_reupload,
      cancelReupload: dto.cancel_reupload,
      approvedMediaIds: dto.approved_media_ids,
    });
    return { message: 'Driver decision queued', result: { queued: 1 } };
  }

  /** The warehouse manager moved a driver's shift-change request in Odoo. */
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
      status: dto.status,
      truckOdooId: dto.truck_odoo_id,
      rejectionReason: dto.rejection_reason,
    });
    return { message: 'Shift-change decision queued', result: { queued: 1 } };
  }

  /**
   * The Odoo administrator proposes a new material.
   *
   * Written straight through rather than queued: the payload is the whole fact,
   * it is idempotent on the Odoo record id, and Odoo needs the backend id back
   * to show the proposal's state on its own form. A queue would hand back a
   * job id and leave that form with nothing to display.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('product-suggestion')
  @HttpCode(200)
  async productSuggestion(
    @Headers('x-odoo-webhook-secret') secret: string | undefined,
    @Body() dto: OdooSuggestionDto,
  ) {
    this.assertAuthorized(secret);
    return this.suggestions.ingestFromOdoo(dto);
  }

  private async queueSync(secret: string | undefined, dto: OdooInventoryWebhookDto) {
    this.assertAuthorized(secret);

    const warehouses = await this.warehouseRepo.find({
      where:
        dto.odoo_warehouse_id != null
          ? { odooWarehouseId: dto.odoo_warehouse_id }
          : { odooWarehouseId: Not(IsNull()) },
    });

    // An id we do not recognise is a warehouse CREATED IN ODOO, not an error.
    //
    // This used to answer 404 and drop the announcement, which made a whole
    // class of warehouse permanently invisible: created on the Odoo dashboard,
    // holding stock and taking shipments, absent from every backend listing,
    // and unable to be added no matter how many times it announced itself. The
    // sync job adopts it — see `adoptOdooWarehouse`.
    if (dto.odoo_warehouse_id != null && warehouses.length === 0) {
      await this.odooSync.enqueueSyncWarehouse({
        odooWarehouseId: dto.odoo_warehouse_id,
        jobId: uuidv4(),
      });
      winstonLogger.info(
        `Odoo announced unknown warehouse ${dto.odoo_warehouse_id} — queued for adoption`,
        { context: 'OdooWebhook', channel: 'jobs' },
      );
      return { message: 'Warehouse sync queued', result: { queued: 1 } };
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
