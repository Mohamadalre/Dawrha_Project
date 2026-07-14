import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';
import { Role } from '@src/user/enums/role.enum';

/** Buyer roles an offer may be limited to. */
export const OFFER_TARGETABLE_ROLES = [
  Role.CITIZEN,
  Role.INSTITUTIONS,
  Role.FACTORY,
  Role.EXTERNAL_PARTNER,
] as const;

/** Uppercases unit codes so 'kg' and 'KG' hit the same measurement_units row. */
const normalizeUnitCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class AdminListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status: 'active' | 'inactive' | 'all' = 'all';

  @IsOptional()
  @IsUUID()
  category_id?: string;
}

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsUUID()
  category_id: string;

  @IsOptional()
  @IsString()
  image?: string;

  @Transform(normalizeUnitCode)
  @IsString()
  @MaxLength(20)
  unit_type: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @Transform(normalizeUnitCode)
  @IsString()
  @MaxLength(20)
  unit_type?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateUnitDto {
  @Transform(normalizeUnitCode)
  @Matches(/^[A-Z0-9_]{1,20}$/, {
    message: 'Unit code must be 1-20 uppercase letters, digits or underscores',
  })
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_en: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_ar: string;

  @IsOptional()
  @IsBoolean()
  is_weight?: boolean;

  /**
   * Consumed by the Odoo warehouse project during sorting: true → the sorter's
   * processed quantity may differ from the shipment's declared quantity;
   * false → must match exactly (e.g. PIECE). Defaults to is_weight.
   */
  @IsOptional()
  @IsBoolean()
  allows_tolerance?: boolean;
}

export class CreateOfferDto {
  @IsUUID()
  product_id: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offer_price: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount_percentage?: number;

  /** Grade the offer applies to — for factory / free-facility buyers. */
  @IsOptional()
  @Transform(normalizeUnitCode)
  @IsString()
  @MaxLength(30)
  condition?: string;

  /** Roles the offer is visible to; omit/empty = every buyer role. */
  @IsOptional()
  @IsArray()
  @IsIn(OFFER_TARGETABLE_ROLES, { each: true })
  target_roles?: Role[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsDateString()
  valid_from?: string;

  @IsOptional()
  @IsDateString()
  valid_until?: string;
}

export class UpdateOfferDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offer_price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount_percentage?: number;

  @IsOptional()
  @Transform(normalizeUnitCode)
  @IsString()
  @MaxLength(30)
  condition?: string;

  @IsOptional()
  @IsArray()
  @IsIn(OFFER_TARGETABLE_ROLES, { each: true })
  target_roles?: Role[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsDateString()
  valid_from?: string;

  @IsOptional()
  @IsDateString()
  valid_until?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateConditionDto {
  @Transform(normalizeUnitCode)
  @Matches(/^[A-Z0-9_]{1,30}$/, {
    message: 'Condition code must be 1-30 uppercase letters, digits or underscores',
  })
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_en: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_ar: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort_order?: number;
}

export class UpdateConditionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_en?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_ar?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_en?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name_ar?: string;

  @IsOptional()
  @IsBoolean()
  is_weight?: boolean;

  @IsOptional()
  @IsBoolean()
  allows_tolerance?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
