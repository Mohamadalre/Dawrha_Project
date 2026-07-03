import { IsString, IsNotEmpty, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Create a truck. New trucks always start ACTIVE; status is managed afterwards.
 * Only the mechanics image is accepted (driving-license & truck images removed).
 */
export class CreateTruckDto {
  @IsString()
  @IsNotEmpty()
  model: string;

  @IsNumber()
  @Type(() => Number)
  year: number;

  @IsString()
  @IsNotEmpty()
  plateNumber: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  maxPayloadKg?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  lengthM?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  widthM?: number;
}
