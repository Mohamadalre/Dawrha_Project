import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { UnitType } from '../../enums/unit-type.enum';

export class AddToCartDto {
  @IsUUID()
  product_id: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsEnum(UnitType)
  unit_type: UnitType;

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
  @IsEnum(UnitType)
  unit_type?: UnitType;
}

export class AddOfferToCartDto {
  @IsUUID()
  offer_id: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsEnum(UnitType)
  unit_type: UnitType;
}
