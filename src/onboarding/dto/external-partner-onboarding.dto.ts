import { Transform } from "class-transformer";
import { normalizeSyrianPhoneNumber } from "@src/common/utils/phone-normalization.provider";
import { CollectionFrequeny } from "@src/user/enums/collectionFrequeny.enum";
import { DeliverySchedule } from "@src/user/enums/delivery-schedule.enum";
import { IsNotEmpty, IsString, IsOptional, Matches, IsArray, ArrayNotEmpty, IsEnum, IsBoolean, IsUUID } from "class-validator";

export class InformationExternalPartnerDto {
    @IsNotEmpty()
    @IsString()
    externalPartnerName: string;


    /**
     * The facility's phone — a MOBILE, and only a mobile.
     *
     * The landline this replaced reached the premises during office hours. A
     * driver standing at a locked gate with a pallet on the truck needs the
     * number of somebody who will pick up, and factories were already asked for
     * exactly this — so the same delivery was resolvable or not depending only
     * on which kind of buyer it was going to.
     *
     * Normalised before validation, so the same number typed as 0993…, +963993…
     * or 963993… is one number rather than three accounts.
     */
    @IsNotEmpty({ message: 'The phone number is required' })
    @IsString()
    @Transform(({ value }) => normalizeSyrianPhoneNumber(value))
    @Matches(/^9639[3-9][0-9]{7}$/, {
        message: 'The phone number must be a Syrian number',
    })
    phoneNumber: string;
}



export class WasteExternalPartnerDto {
    // UUIDs only — a non-uuid id would otherwise reach the `IN (...)` query and
    // surface as a Postgres 500 rather than a clear validation message.
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