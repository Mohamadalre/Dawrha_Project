import { Transform } from "class-transformer";
import { normalizeSyrianPhoneNumber } from "@src/common/utils/phone-normalization.provider";
import { CollectionFrequeny } from "@src/user/enums/collectionFrequeny.enum";
import { DeliverySchedule } from "@src/user/enums/delivery-schedule.enum";
import { IsNotEmpty, IsString, IsOptional, Matches, IsArray, ArrayNotEmpty, IsEnum, IsBoolean } from "class-validator";

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