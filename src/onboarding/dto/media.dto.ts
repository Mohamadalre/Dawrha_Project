import { MediaType } from '@src/media/entities/media.entity';
import {
    IsString,
    IsNotEmpty,
    IsEnum
} from 'class-validator';

export class MediaDto {
    @IsNotEmpty()
    @IsEnum(MediaType)
    @IsString()
    fileType: MediaType;
}