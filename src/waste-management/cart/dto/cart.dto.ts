import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/** Uppercases unit codes so 'kg' and 'KG' hit the same measurement_units row. */
const normalizeUnitCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class AddToCartDto {
  @IsUUID()
  product_id: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity: number;

  @Transform(normalizeUnitCode)
  @IsString()
  @MaxLength(20)
  unit_type: string;

  /** Material grade being ordered — REQUIRED for factory / free-facility buyers. */
  @IsOptional()
  @Transform(normalizeUnitCode)
  @IsString()
  @MaxLength(30)
  condition?: string;

  @IsOptional()
  @IsBoolean()
  add_offer?: boolean;
}

export class UpdateCartItemDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @Transform(normalizeUnitCode)
  @IsString()
  @MaxLength(20)
  unit_type?: string;
}

export class AddOfferToCartDto {
  @IsUUID()
  offer_id: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity: number;

  @Transform(normalizeUnitCode)
  @IsString()
  @MaxLength(20)
  unit_type: string;
}
