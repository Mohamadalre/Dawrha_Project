import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsPositive, IsUUID } from 'class-validator';

/** The driver weighs the collected material at the pickup. */
export class CollectedRequestDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  actualWeightKg: number;
}

/** The delivery warehouse where the material was taken (nullable: origin default). */
export class DeliveredRequestDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}