import { Transform } from "class-transformer";
import { normalizeSyrianPhoneNumber } from "@src/common/utils/phone-normalization.provider";
import { CollectionFrequeny } from "@src/user/enums/collectionFrequeny.enum";
import { IsNotEmpty, IsString, IsOptional, Matches, IsEnum,IsUUID, IsArray, ArrayNotEmpty } from "class-validator";

export class InformationInstitutionDto {
    @IsNotEmpty()
    @IsString()
    institutionName: string;

    @IsOptional()
    @IsString()
    @IsUUID()
    institutionTypeId: string;

    @IsOptional()
    @IsString()
    otherInstitutionType?: string;

    @IsString()
    @IsNotEmpty()
    licenseNumber: string;

    @IsString()
    @IsOptional()
    taxNumber?: string;

    /**
     * The institution's phone — a MOBILE, and the only number asked for.
     *
     * A landline used to be required beside it. Two columns for one answer
     * means two places to look and one of them is always the wrong one: the
     * number that matters is the one a driver at a locked gate can ring, and a
     * building's landline is not it outside office hours. Factories and free
     * facilities were already asked for a single mobile, so the same delivery
     * was resolvable or not depending only on which kind of buyer it was going
     * to.
     *
     * Normalised before validation, so `09xx`, `+9639xx` and `9639xx` all reach
     * the same stored string and the uniqueness check cannot be walked past by
     * retyping the number in another format.
     */
    @IsNotEmpty({ message: 'The phone number is required' })
    @IsString()
    @Transform(({ value }) => normalizeSyrianPhoneNumber(value))
    @Matches(/^9639[3-9][0-9]{7}$/, {
        message: 'The phone number must be a Syrian number',
    })
    phoneNumber: string;
}


export class WasteInstitutionDto {
    @IsArray()
    @IsString({ each: true })
    wasteCategoryId: string[];


    @IsNotEmpty()
    @IsString()
    estimatedWasteQuantity: string;

    @IsNotEmpty()
    @IsEnum(CollectionFrequeny)
    @IsString()
    collectionFrequney: CollectionFrequeny;

    @IsArray()
    @ArrayNotEmpty()
    @IsString({ each: true })
    preferredCollectionTime: string[];


}