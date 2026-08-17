import { Transform } from "class-transformer";
import { normalizeSyrianPhoneNumber } from "@src/common/utils/phone-normalization.provider";
import { IsNotEmpty, IsString, Matches, IsArray, ArrayNotEmpty, IsUUID, IsNumber, IsPositive } from "class-validator";

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


    // A free facility gives only what it recycles and how much a typical order
    // is — the categories above and this positive quantity. Everything else
    // (schedule, delivery preference, delivery windows) was removed: a free
    // facility does not schedule or arrange delivery the way a factory does.
    @IsNumber({}, { message: 'The estimated order quantity must be a positive number' })
    @IsPositive({ message: 'The estimated order quantity must be a positive number' })
    averageOrderQuantity: number;


}