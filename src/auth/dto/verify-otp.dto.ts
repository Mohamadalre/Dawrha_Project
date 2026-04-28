import { DeviceType } from "@src/user/enums/deviec-type.enum";
import { IsNotEmpty, Matches, IsString, IsOptional, IsEnum } from "class-validator";
import { DeviceDto } from "./auth.dto";


export class VerifyOtpDto extends DeviceDto {


    @IsNotEmpty({ message: 'The otpCode is required' })
    @Matches(/^\d{5}$/, {
        message: 'OTP must be exactly 5 digits',
    })

    otpCode: string

}