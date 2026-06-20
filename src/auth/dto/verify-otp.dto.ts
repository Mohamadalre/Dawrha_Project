
import { IsNotEmpty, Matches } from "class-validator";
import { DeviceDto } from "./auth.dto";


export class VerifyOtpDto extends DeviceDto {


    @IsNotEmpty({ message: 'The otpCode is required' })
    @Matches(/^\d{5}$/, {
        message: 'OTP must be exactly 5 digits',
    })

    otpCode: string

}