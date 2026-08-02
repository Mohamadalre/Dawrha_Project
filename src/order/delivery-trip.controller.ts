import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { DeliveryTripService } from './providers/delivery-trip.service';

class PlanTripDto {
  /**
   * One inner array per truck, holding the part ids that truck will carry.
   *
   * Omitted, everything goes on one truck. The system does not decide this
   * itself: splitting by capacity means comparing a load to a payload in
   * kilograms, and this catalogue measures some materials in kilograms and
   * others in pieces — a system that guessed would sometimes send one truck
   * for a load it cannot carry, and the failure would show up at the warehouse
   * gate with the goods already picked.
   */
  @IsOptional()
  @IsArray()
  truck_groups?: string[][];
}

class AssignTripDto {
  @IsInt()
  @Min(1)
  odoo_truck_id: number;

  @IsInt()
  @Min(1)
  odoo_driver_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  driver_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  driver_phone?: string;
}

class PickupDto {
  @IsOptional()
  @IsString()
  @MaxLength(400)
  note?: string;
}

/**
 * Routing a split order to the buyer.
 *
 * A buyer order that no single warehouse could fill ends up in several, and all
 * of them have to reach the buyer. These routes plan ONE truck run that starts
 * at the farthest warehouse, calls at the nearer ones on the way in, and
 * arrives loaded — and they record custody changing hands at every stop, which
 * is the only thing that can answer "who had this part when it went missing".
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/orders', version: '1' })
export class DeliveryTripController {
  constructor(private readonly trips: DeliveryTripService) {}

  /** Build the route(s) and cost them at the rate in force today. */
  @Post(':orderId/delivery/plan')
  @Permissions('admin.orders.manage')
  async plan(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: PlanTripDto,
  ) {
    return this.trips.planForOrder(orderId, dto.truck_groups);
  }

  /** What is planned or running for this order. */
  @Get(':orderId/delivery')
  @Permissions('admin.orders.view')
  async forOrder(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.trips.forOrder(orderId);
  }

  /** Put a truck and driver on a planned trip. */
  @Post('delivery/trips/:tripId/assign')
  @Permissions('admin.orders.manage')
  async assign(
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: AssignTripDto,
  ) {
    return this.trips.assign(tripId, {
      odooTruckId: dto.odoo_truck_id,
      odooDriverId: dto.odoo_driver_id,
      driverName: dto.driver_name,
      driverPhone: dto.driver_phone,
    });
  }

  /**
   * The driver's own list — the trips they are on, in route order.
   *
   * Keyed by the Odoo driver id because delivery drivers are recruited and live
   * in Odoo; they have no account in this backend to authenticate as.
   */
  @Get('delivery/drivers/:odooDriverId/trips')
  @Permissions('admin.orders.view')
  async forDriver(@Param('odooDriverId', ParseIntPipe) odooDriverId: number) {
    return this.trips.forDriver(odooDriverId);
  }

  /** The driver confirms taking one warehouse's goods. */
  @Post('delivery/trips/:tripId/stops/:stopId/pickup')
  @Permissions('admin.orders.manage')
  async pickup(
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
    @Body() dto: PickupDto,
  ) {
    return this.trips.confirmPickup(tripId, stopId, dto.note);
  }

  /**
   * The driver hands the whole load over at the buyer.
   *
   * This does NOT complete the order. The buyer confirms receipt themselves
   * (`POST /orders/:orderId/confirm-receipt`) — two signatures on one handover
   * is what protects both sides of it.
   */
  @Post('delivery/trips/:tripId/complete')
  @Permissions('admin.orders.manage')
  async complete(@Param('tripId', ParseUUIDPipe) tripId: string) {
    return this.trips.completeTrip(tripId);
  }
}
