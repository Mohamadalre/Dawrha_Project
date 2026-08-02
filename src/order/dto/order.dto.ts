import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FulfilmentMode } from '../enums/fulfilment-mode.enum';
import { ComplaintKind } from '../enums/complaint-kind.enum';

export class CheckoutDto {
  /**
   * Optional, and only meaningful for a factory. A free facility always
   * collects, so the value is resolved rather than rejected — failing a
   * checkout over a field the buyer may never have been shown would be
   * needlessly hostile.
   */
  @IsOptional()
  @IsEnum(FulfilmentMode)
  fulfilment_mode?: FulfilmentMode;

  /**
   * The buyer's answer, up front, to "ship what is available if a little is
   * missing?". Asked once at checkout so a shortfall never has to be resolved
   * by guessing, and a short shipment is never a surprise.
   */
  @IsOptional()
  @IsBoolean()
  accept_partial_fulfilment?: boolean;
}

export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(400)
  reason?: string;
}

export class RatePartDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  stars: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class FileComplaintDto {
  @IsEnum(ComplaintKind)
  kind: ComplaintKind;

  @IsString()
  @MaxLength(2000)
  description: string;

  /** How much was missing — lets a shortage be checked against Odoo's log. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  claimed_shortfall?: number;
}
