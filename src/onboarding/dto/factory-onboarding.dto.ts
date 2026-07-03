
import { normalizeSyrianPhoneNumber } from "@src/common/utils/phone-normalization.provider";
import { CollectionFrequeny } from "@src/user/enums/collectionFrequeny.enum";
import { DeliverySchedule } from "@src/user/enums/delivery-schedule.enum";
import { Transform } from 'class-transformer';
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

    @IsNotEmpty({message:'The phone number is required'})
    @IsString()
    @Transform(({ value }) => normalizeSyrianPhoneNumber(value)) 
    @Matches(/^9639[3-9][0-9]{7}$/, {
    message: 'The phone number must be a Syrian number',
  })
   phoneNumber: string;

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