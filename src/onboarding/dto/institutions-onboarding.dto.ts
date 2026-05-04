import { CollectionFrequeny } from "@src/user/enums/collectionFrequeny.enum";
import { IsNotEmpty, IsString, IsOptional, Matches, IsEnum, IsArray, ArrayNotEmpty } from "class-validator";

export class InformationInstitutionDTo {
    @IsNotEmpty()
    @IsString()
    institutionName: string;

    @IsOptional()
    @IsString()
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
    @Matches(/^011[0-9][0-9]{7}$/, {
        message: 'The phone number must be a Syrian number',
    })
    landlinePhone: string;
}


export class WasteInstitutionDTo {
    @IsArray()
    @IsOptional()
    @IsString({ each: true })
    wasteCategoryId: string[];


    @IsNotEmpty()
    @IsString()
    estimatedWasteQuantity: string;

    @IsNotEmpty()
    @IsEnum(CollectionFrequeny)
    @IsString()
    collectionFrequney: string;

    @IsArray()
    @ArrayNotEmpty()
    @IsString({ each: true })
    preferredCollectionTime?: string[];


}