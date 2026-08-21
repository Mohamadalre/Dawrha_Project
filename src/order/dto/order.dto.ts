import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { FulfilmentMode } from '../enums/fulfilment-mode.enum';
import { ComplaintKind } from '../enums/complaint-kind.enum';
import { OrderStatus } from '../enums/order-status.enum';
import { PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';

/**
 * Listing a buyer's own orders, optionally narrowed to one status — so a factory
 * or free facility can pull just their rejected orders, just what is being
 * prepared, and so on, rather than filtering a full list on the client.
 */
export class ListOrdersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

/** One line the admin types when placing an order for a buyer. */
export class AdminOrderItemDto {
  @IsString()
  productId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsString()
  conditionCode?: string;
}

/**
 * The admin places an order ON BEHALF OF a buyer (a factory or free facility)
 * whose own order fell short — items named explicitly, not from a cart.
 */
export class AdminCreateOrderDto {
  @IsString()
  buyerAccountId: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AdminOrderItemDto)
  items: AdminOrderItemDto[];

  @IsOptional()
  @IsEnum(FulfilmentMode)
  fulfilmentMode?: FulfilmentMode;

  @IsOptional()
  @IsBoolean()
  acceptPartialFulfilment?: boolean;
}

/** The warehouse set the admin chose when modifying a split order. */
export class ApplyModificationDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  warehouseIds: string[];
}

/** Admin listing of all orders, optionally narrowed to one status. */
export class AdminListOrdersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

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

export class PartialDecisionDto {
  /**
   * The buyer's answer to "ship what is available?". `true` proceeds on the
   * covered quantity; `false` cancels the order. Required — there is no safe
   * default for spending money on a short order.
   */
  @IsBoolean()
  accept: boolean;
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
