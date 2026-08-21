import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationType } from '../enums/notification-type.enum';
import { clampPageParam, MAX_PAGE_LIMIT } from '@src/waste-management/common/dto/pagination.dto';

export class NotificationQueryDto {
  @IsOptional()
  // Floored, defaulted and clamped — pagination never 400s on a bad number, so
  // a client that over-asks gets the most we serve, not an empty list.
  @Transform(({ value }) => clampPageParam(value, 1, Number.MAX_SAFE_INTEGER, 1))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => clampPageParam(value, 1, MAX_PAGE_LIMIT, 20))
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit = 20;

  @IsOptional()
  @Transform(({ value }) => String(value).toUpperCase())
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  @IsOptional()
  @Transform(({ value }) => String(value).toUpperCase())
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsIn(['createdAt', 'sentAt', 'readAt', 'updatedAt'])
  sortBy?: string;

  @IsOptional()
  @Transform(({ value }) => String(value).toUpperCase())
  @IsIn(['ASC', 'DESC'])
  order: 'ASC' | 'DESC' = 'DESC';
}
