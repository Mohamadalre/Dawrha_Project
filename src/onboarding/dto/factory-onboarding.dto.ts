
import { normalizeSyrianPhoneNumber } from "@src/common/utils/phone-normalization.provider";
import { CollectionFrequeny } from "@src/user/enums/collectionFrequeny.enum";
import { DeliverySchedule } from "@src/user/enums/delivery-schedule.enum";
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsOptional, Matches, IsArray, ArrayNotEmpty, IsEnum, IsBoolean, IsUUID } from "class-validator";


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
    // Must be UUIDs. Without this a free-typed id (or a name) reached the
    // `IN (...)` query and Postgres answered "invalid input syntax for type
    // uuid" as a 500 — the applicant saw a database error instead of a clear
    // "this category id is not valid". checkWasteType still de-duplicates and
    // reports ids that do not exist.
    @IsArray()
    @ArrayNotEmpty()
    @IsUUID('all', { each: true, message: 'Each waste category id must be a valid id' })
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