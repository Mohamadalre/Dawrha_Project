import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CollectionRequestStatus } from '../enums/collection-request-status.enum';
import { CollectionRequestType } from '../enums/collection-request-type.enum';

// --- Admin request listing ----------------------------------------------------

/** Admin-scoped listing: any status/type, date window and driver filters. */
export class AdminListRequestsQueryDto {
  @IsOptional()
  @IsEnum(CollectionRequestStatus)
  status?: CollectionRequestStatus;

  @IsOptional()
  @IsEnum(CollectionRequestType)
  type?: CollectionRequestType;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  driver_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class AssignCollectionRequestDto {
  @IsUUID()
  driver_id: string;
}

export class AdminCancelRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

// --- Coverage points ----------------------------------------------------------

const POINT_TYPES = ['SCHOOL', 'MARKET', 'HOSPITAL', 'GENERAL'] as const;

export class CreateCoveragePointDto {
  @IsString()
  @Length(2, 255)
  name: string;

  @IsOptional()
  @IsIn(POINT_TYPES)
  point_type: string = 'GENERAL';

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-90)
  @Max(90)
  lat: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-180)
  @Max(180)
  lng: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  radius_m: number = 1000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  priority: number = 0;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

export class UpdateCoveragePointDto {
  @IsOptional()
  @IsString()
  @Length(2, 255)
  name?: string;

  @IsOptional()
  @IsIn(POINT_TYPES)
  point_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  radius_m?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

// --- Dispatch configuration ---------------------------------------------------

export class DispatchWeightsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  proximity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  direction?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  load?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  vehicle?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  deadline?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  fairness?: number;
}

export class UpdateDispatchConfigDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DispatchWeightsDto)
  weights?: DispatchWeightsDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  accept_window_sec?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  scheduled_lead_min?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  route_merge_max_min?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  route_merge_max_km?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  institution_tolerance_min?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(240)
  rebalance_min?: number;

  @IsOptional()
  @IsBoolean()
  is_enabled?: boolean;
}