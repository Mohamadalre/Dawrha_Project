import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, Min } from 'class-validator';

export class SetPricingDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  individual: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  company: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  factory: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  free_facility: number;

  @IsOptional()
  @IsDateString()
  effective_from?: string;

  @IsOptional()
  @IsDateString()
  effective_until?: string;
}
