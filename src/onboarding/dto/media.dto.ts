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

// export class MediaCollectorDto {
//     @IsNotEmpty()
//     @IsEnum({MediaType.ID_CARD_FRONT,MediaType.ID_CARD_BACK})
//     @IsString()
//     fileType: MediaType;
// }