
import { IsNotEmpty, IsString, IsOptional, Matches, IsEnum, IsArray, ArrayNotEmpty } from "class-validator";


export class InformationInstitutionDTo {
    @IsNotEmpty()
    @IsString()
    factoryName: string;


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