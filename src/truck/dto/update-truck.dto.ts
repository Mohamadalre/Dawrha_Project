import { IsString, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Edit a truck's information. Status is NOT changed here (see PATCH :id/status). */
export class UpdateTruckDto {
  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  year?: number;

  @IsOptional()
  @IsString()
  plateNumber?: string;

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
