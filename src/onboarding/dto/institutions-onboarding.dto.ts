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

    @IsString()
    @IsNotEmpty()
    @Matches(/^011[1-9][0-9]{5}$/, {
        message: 'The landline phone number must be a Syrian number',
    })
    landlinePhone: string;
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