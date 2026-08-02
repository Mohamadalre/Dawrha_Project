import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '@src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@src/permission/guards/permissions.guard';
import { Permissions } from '@src/permission/derorators/permissions.decorator';
import { CurrentUser } from '@src/auth/decorators/current-user.decorator';
import { DeliveryRateService } from './providers/delivery-rate.service';

export class SetDeliveryRateDto {
  /** Cost of one kilometre. The number every delivery quote is built from. */
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  rate_per_km: number;

  /** Charged once per delivery, before distance. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  base_fee?: number;

  /** Floor for one delivery — a short trip still costs a driver and a vehicle. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  min_charge?: number;

  @IsOptional()
  @IsString()
  @Length(3, 8)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateDeliveryRateDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  rate_per_km?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  base_fee?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  min_charge?: number;

  @IsOptional()
  @IsString()
  @Length(3, 8)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/**
 * The per-kilometre delivery rate — authored HERE, by the backend administrator.
 *
 * Kept apart from the Odoo tariff mirror (`delivery_tariffs`), which the sync
 * job replaces wholesale on every change: a value written into that table by
 * this backend would disappear the next time anyone edited a tariff in Odoo,
 * silently and with nothing to trace. Two authors need two tables.
 *
 * Setting a new rate never overwrites the old one — a delivery quoted last month
 * was quoted at last month's rate, and rewriting the number in place would make
 * every past quote unexplainable.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'admin/delivery-rate', version: '1' })
export class DeliveryRateController {
  constructor(private readonly rates: DeliveryRateService) {}

  /** The rate in force, plus the last twenty that preceded it. */
  @Get()
  @Permissions('admin.delivery.rate.view')
  async view() {
    const result = await this.rates.view();
    return { message: 'Delivery rate fetched successfully', result };
  }

  /** Set a NEW rate. The previous one is closed and kept. */
  @Post()
  @Permissions('admin.delivery.rate.manage')
  async set(@CurrentUser() user, @Body() dto: SetDeliveryRateDto) {
    return this.rates.set(dto, user.id);
  }

  /** Correct the rate currently in force — a typo, not a new decision. */
  @Patch(':id')
  @Permissions('admin.delivery.rate.manage')
  async update(
    @CurrentUser() user,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliveryRateDto,
  ) {
    return this.rates.update(id, dto, user.id);
  }

  /**
   * What a given distance costs at the current rate.
   *
   * Exposed so the admin can check the effect of a change before committing to
   * it, rather than working it out on paper and discovering the floor later.
   */
  @Get('quote')
  @Permissions('admin.delivery.rate.view')
  async quote(@Query('distance_km') distanceKm: string) {
    const result = await this.rates.quote(Number(distanceKm));
    return { message: 'Delivery quote calculated successfully', result };
  }
}
