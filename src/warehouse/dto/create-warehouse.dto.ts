import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { WarehouseZoneType } from '../enums/warehouse-zone-type.enum';

/** One zone of the warehouse (e.g. a "Main Storage" zone of type STORAGE). */
export class WarehouseZoneDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsEnum(WarehouseZoneType)
  type: WarehouseZoneType;
}

/**
 * Create a warehouse FROM the backend. It is saved locally (PENDING) and then
 * pushed to Odoo by a background job; the admin only assigns a manager in Odoo.
 */
export class CreateWarehouseDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  code: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  /** Optional custom zones. If omitted, Odoo provisions the default zones. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => WarehouseZoneDto)
  zones?: WarehouseZoneDto[];
}
