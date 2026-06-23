import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { UnitType } from '../../enums/unit-type.enum';

export class CreateSuggestionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  product_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsUUID()
  category_id: string;

  @IsEnum(UnitType)
  unit_type: UnitType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  estimated_price?: number;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  additional_info?: string;
}
