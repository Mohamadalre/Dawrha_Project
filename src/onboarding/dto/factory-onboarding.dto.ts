
import { normalizeSyrianPhoneNumber } from "@src/common/utils/phone-normalization.provider";
import { Transform, Type } from 'class-transformer';
import { IsNotEmpty, IsString, IsOptional, Matches, IsArray, ArrayNotEmpty, IsBoolean, IsUUID, IsNumber, IsPositive, ValidateNested } from "class-validator";
import { DeliveryTimeSlotDto } from "./delivery-time-slot.dto";


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


    // The estimated size of a typical order — a positive number, not free text.
    // A zero or a negative estimate is meaningless for planning, so both are
    // rejected here rather than stored and surprising the dispatcher later.
    @IsNumber({}, { message: 'The estimated order quantity must be a positive number' })
    @IsPositive({ message: 'The estimated order quantity must be a positive number' })
    averageOrderQuantity: number;

    // Does the factory want the order DELIVERED (true) or will it collect (false).
    @IsNotEmpty()
    @IsBoolean()
    deliveryPreference: boolean;

    // The detailed windows the factory can receive a delivery in — a weekday +
    // a start→end time, as many as it likes. Replaces the old single
    // morning/afternoon/evening enum. Optional: a factory that self-collects
    // (deliveryPreference = false) has no windows to give.
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DeliveryTimeSlotDto)
    deliveryTimeSlots?: DeliveryTimeSlotDto[];


}