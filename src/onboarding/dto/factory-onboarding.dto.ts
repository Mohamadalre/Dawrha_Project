
import { CollectionFrequeny } from "@src/user/enums/collectionFrequeny.enum";
import { DeliverySchedule } from "@src/user/enums/delivery-schedule.enum";
import { IsNotEmpty, IsString, IsOptional, Matches, IsArray, ArrayNotEmpty, IsEnum, IsBoolean } from "class-validator";


export class InformationFactoryDto {
    @IsNotEmpty()
    @IsString()
    factoryName: string;

    @IsString()
    @IsNotEmpty()
    commercialRecord: string;

    @IsString()
    @IsNotEmpty()
    industrialRecord: string;

    @IsString()
    @IsOptional()
    taxNumber?: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/^011[0-9][0-9]{6}$/, {
        message: 'The phone number must be a Syrian number',
    })
    landlinePhone: string;
}



export class WasteFactoryDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsString({ each: true })
    wasteCategoryId: string[];


    @IsNotEmpty()
    @IsString()
    averageOrderQuantity: string;

    @IsNotEmpty()
    @IsEnum(CollectionFrequeny)
    @IsString()
    estimationOrderSchedule: CollectionFrequeny;

    @IsNotEmpty()
    @IsBoolean()
    deliveryPreference: boolean;

    @IsOptional()
    @IsEnum(DeliverySchedule)
    @IsString()
    perferredDeliverySchedule: DeliverySchedule;


}