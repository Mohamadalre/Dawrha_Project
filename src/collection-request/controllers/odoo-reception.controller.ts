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
import { IsString, IsNotEmpty } from 'class-validator';
import { timingSafeEqual } from 'crypto';
import { ShipmentService } from '../services/shipment.service';

/**
 * Body of the reception scan: the two ids that came off the QR + the scanning
 * employee's warehouse. Both are BACKEND ids (uuids) — the warehouse is the
 * employee's own backend warehouse id, resolved on the Odoo side from
 * `recycle.warehouse.backend_id`.
 */
class ReceiveShipmentDto {
  @IsString()
  @IsNotEmpty()
  backend_shipment_id!: string;

  @IsString()
  @IsNotEmpty()
  warehouse_backend_id!: string;
}

/**
 * Inbound, server-to-server channel for the RECEPTION scan (Odoo → backend).
 *
 * The receiving employee lives ONLY in Odoo (group_recycle_input), scoped to
 * their warehouse there. When they scan a shipment's QR, the Odoo reception
 * controller calls THIS route with the shared secret — never the browser, and
 * never a JWT client. The backend enforces warehouse isolation, flips the
 * shipment to DELIVERED, and returns the load (materials + quantities + unit +
 * weight + driver + truck) so Odoo can mirror it as a `recycle.shipment`.
 *
 * Auth: the same `x-odoo-webhook-secret` shared secret the Odoo webhooks use,
 * compared in constant time. Unset secret = endpoint off.
 */
@Controller({ path: 'odoo/shipments', version: '1' })
export class OdooReceptionController {
  constructor(
    private readonly config: ConfigService,
    private readonly shipmentService: ShipmentService,
  ) {}

  /**
   * SCAN (read only): fetch the load for the reception screen + mirror into
   * Odoo. Enforces warehouse isolation but does NOT change the backend status —
   * scanning is a look, not a receipt.
   */
  @Post('receive')
  @HttpCode(200)
  async receive(
    @Headers('x-odoo-webhook-secret') secret: string | undefined,
    @Body() dto: ReceiveShipmentDto,
  ) {
    this.assertAuthorized(secret);
    const result = await this.shipmentService.getShipmentForReception(
      dto.backend_shipment_id,
      dto.warehouse_backend_id,
    );
    return { message: 'Shipment fetched', result };
  }

  /**
   * CONFIRM: the receiving employee accepted the truck in Odoo. NOW flip the
   * backend shipment to RECEIVED (and complete its requests) so the driver sees
   * the receipt. Same isolation guard; idempotent on re-confirm.
   */
  @Post('confirm')
  @HttpCode(200)
  async confirm(
    @Headers('x-odoo-webhook-secret') secret: string | undefined,
    @Body() dto: ReceiveShipmentDto,
  ) {
    this.assertAuthorized(secret);
    const result = await this.shipmentService.confirmShipmentReceipt(
      dto.backend_shipment_id,
      dto.warehouse_backend_id,
    );
    return { message: 'Shipment received', result };
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
