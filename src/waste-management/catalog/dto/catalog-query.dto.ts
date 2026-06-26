import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '@src/waste-management/common/dto/pagination.dto';

export class CategoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['name', 'created_at'])
  sort: 'name' | 'created_at' = 'name';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'asc';
}

export class ProductQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['name', 'price', 'popularity'])
  sort: 'name' | 'price' | 'popularity' = 'name';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'asc';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price_min?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price_max?: number;
}

export class SearchQueryDto extends PaginationQueryDto {
  @IsString()
  @IsNotEmpty()
  query: string;

  @IsOptional()
  @IsIn(['all', 'product', 'category'])
  type: 'all' | 'product' | 'category' = 'all';
}

export class ByPriceQueryDto extends PaginationQueryDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  min_price: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  max_price: number;
}

export class OfferQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Boolean)
  active_only: boolean = true;

  @IsOptional()
  @IsIn(['discount', 'created_at'])
  sort: 'discount' | 'created_at' = 'discount';
}

export class OfferSearchQueryDto extends PaginationQueryDto {
  @IsString()
  @IsNotEmpty()
  query: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;
}
