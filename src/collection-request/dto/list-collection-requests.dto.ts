import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CollectionRequestStatus } from '../enums/collection-request-status.enum';
import { CollectionRequestType } from '../enums/collection-request-type.enum';

/** Owner-scoped listing: status and type filters over the caller's requests. */
export class ListCollectionRequestsQueryDto {
  @IsOptional()
  @IsEnum(CollectionRequestStatus)
  status?: CollectionRequestStatus;

  @IsOptional()
  @IsEnum(CollectionRequestType)
  type?: CollectionRequestType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}
