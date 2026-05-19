import { IsString, IsNotEmpty, IsNumber, IsOptional, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

const TRUCK_STATUSES = ['active', 'maintenance', 'inactive'] as const;

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
  maxPayloadKg?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lengthM?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  widthM?: number;

  @IsOptional()
  @IsString()
  @IsIn(TRUCK_STATUSES)
  status?: string;
}
