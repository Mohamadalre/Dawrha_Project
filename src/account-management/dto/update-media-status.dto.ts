import { IsEnum, IsNotEmpty } from 'class-validator';
import { statusMedia } from '@src/media/entities/media.entity';

export class UpdateMediaStatusDto {
  @IsEnum(statusMedia)
  @IsNotEmpty()
  status: statusMedia;
}
