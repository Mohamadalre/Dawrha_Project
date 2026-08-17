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
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { timingSafeEqual } from 'crypto';
import { winstonLogger } from '@src/core/logger-config/winston.config';
import { DeliveryTripService } from './providers/delivery-trip.service';

class OdooDeliveryEventDto {
  @IsString()
  @MaxLength(64)
  event: string;

  /** The backend trip id — what the delivery trip was pushed under. */
  @IsString()
  @MaxLength(64)
  backend_trip_id: string;

  /** The stop the driver collected (for a `picked_up` event). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  backend_stop_id?: string;

  @IsOptional()
  @IsInt()
  stop_sequence?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  trip_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  picked_up_at?: string;
}

/**
 * Delivery-trip events coming back from Odoo.
 *
 * The driver runs the trip in Odoo — confirms each pickup, hands the load over —
 * and each of those is reported here so the backend, which owns the order the
 * buyer is watching, moves the parts to DISPATCHED and then DELIVERED.
 *
 * Lives in the order module rather than beside the other Odoo webhooks so it can
 * call the trip service directly — the alternative would make the sync and order
 * modules depend on each other. Same shared-secret auth as those webhooks.
 */
@Controller({ path: 'odoo/webhooks', version: '1' })
export class DeliveryWebhookController {
  constructor(
    private readonly trips: DeliveryTripService,
    private readonly config: ConfigService,
  ) {}

  @Post('delivery')
  @HttpCode(202)
  async delivery(
    @Headers('x-odoo-webhook-secret') secret: string | undefined,
    @Body() dto: OdooDeliveryEventDto,
  ) {
    this.assertAuthorized(secret);
    if (!dto.backend_trip_id) {
      return { message: 'Ignored — no trip', applied: false };
    }

    try {
      if (dto.event === 'picked_up' && dto.backend_stop_id) {
        await this.trips.applyOdooPickup(dto.backend_trip_id, dto.backend_stop_id);
      } else if (dto.event === 'completed') {
        await this.trips.applyOdooComplete(dto.backend_trip_id);
      } else {
        return { message: 'Ignored — unhandled event', applied: false };
      }
    } catch (error) {
      // A retried webhook (a stop already collected, a trip already completed)
      // must not error-loop against Odoo, which retries on failure. It is logged
      // and acknowledged; the reconcile pass corrects any genuine divergence.
      winstonLogger.warn(
        `Delivery event ${dto.event} on trip ${dto.backend_trip_id} not applied: ${(error as Error).message}`,
        { context: 'DELIVERY_WEBHOOK', channel: 'orders' },
      );
      return { message: 'Noted', applied: false };
    }
    return { message: 'Applied', applied: true };
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
