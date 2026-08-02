import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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

  /**
   * Street address — REQUIRED, and not editable afterwards.
   *
   * A warehouse is a physical building that drivers are sent to and buyers
   * collect from. Coordinates put a pin on a map; they do not tell a driver
   * which gate, and a collection order printed with an empty address is one the
   * buyer cannot act on.
   *
   * Required here rather than "encouraged": the field was optional and half the
   * warehouses on the system have none, which is not an accident — an optional
   * field on a creation form is a field that gets skipped.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  address: string;

  /**
   * Governorate — REQUIRED, and given as the id of a `provinces` row.
   *
   * Order allocation matches a buyer to warehouses by this id. A warehouse
   * created without one is invisible to every order the moment it exists: it
   * holds stock nobody can be routed to, and the failure surfaces as "no
   * warehouse can fulfil this" rather than as anything pointing back here.
   *
   * By id and not by name. A typed governorate is matched against a list it
   * cannot be checked against, so "دمشق" and "ريف دمشق" become two warehouses
   * in places one of which does not exist.
   */
  @IsUUID('4', { message: 'A governorate must be chosen for the warehouse' })
  provinceId: string;

  /** Optional custom zones. If omitted, Odoo provisions the default zones. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => WarehouseZoneDto)
  zones?: WarehouseZoneDto[];
}
