import { MediaType } from '@src/media/entities/media.entity';
import {
    IsString,
    IsNotEmpty,
    IsEnum,
    IsIn,
} from 'class-validator';

export class MediaDto {
    @IsNotEmpty()
    @IsEnum(MediaType)
    @IsString()
    fileType: MediaType;
}

/**
 * Per-role document DTOs. Each restricts `fileType` to the document types that
 * role actually uploads, so the validation error lists ONLY those values
 * (e.g. institutions see "LICENSE", not every MediaType).
 */

/** Collector: national ID card front & back only. */
export class CollectorMediaDto {
    @IsNotEmpty()
    @IsIn([MediaType.ID_CARD_FRONT, MediaType.ID_CARD_BACK])
    fileType: MediaType;
}

/** Institution: license only. */
export class InstitutionMediaDto {
    @IsNotEmpty()
    @IsIn([MediaType.LICENSE])
    fileType: MediaType;
}

/** Factory: license + industrial registration. */
export class FactoryMediaDto {
    @IsNotEmpty()
    @IsIn([MediaType.LICENSE, MediaType.INDUSTRIAL_REG])
    fileType: MediaType;
}

/** Free facility: an optional facility licence. */
export class ExternalPartnerMediaDto {
    @IsNotEmpty()
    @IsIn([MediaType.LICENSE])
    fileType: MediaType;
}
