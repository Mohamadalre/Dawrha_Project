import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class TruckLocationDto {
  @IsUUID()
  truckId: string;

  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  speed?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;
}

export interface StoredTruckLocation {
  truckId: string;
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  driverId?: string;
  updatedAt: string;
}
