import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
  Min,
} from 'class-validator';

/** Actual quantity received for one product line. */
export class ReceivedLineDto {
  /**
   * Blank when the driver app reports a bulk weigh without a per-product
   * split — such entries carry no line info and are skipped by the service,
   * so they pass validation instead of rejecting the whole weigh.
   */
  @ValidateIf((o) => o.product_id != null && o.product_id !== '')
  @IsUUID()
  product_id?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity: number;
}

/** The driver weighs the collected material at the pickup. */
export class CollectedRequestDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  actualWeightKg: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivedLineDto)
  received_lines?: ReceivedLineDto[];

  @IsOptional()
  @IsBoolean()
  truck_full?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  driver_note?: string;
}

/** The delivery warehouse where the material was taken (nullable: origin default). */
export class DeliveredRequestDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
