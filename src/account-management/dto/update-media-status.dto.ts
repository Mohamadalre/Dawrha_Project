import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { statusMedia } from '@src/media/entities/media.entity';

export class UpdateMediaStatusDto {
  @IsEnum(statusMedia)
  @IsNotEmpty()
  status: statusMedia;

  /** Rejection reason — sent to the account owner when status is REJECTED. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
