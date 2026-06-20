
import { IsEmail, IsNotEmpty, Matches } from "class-validator";



export class VerifyResetOtpDto {


    
    @IsNotEmpty({ message: 'The email is required' })
    @IsEmail()
    email: string;
    
    @IsNotEmpty({ message: 'The otpCode is required' })
    @Matches(/^\d{5}$/, {
        message: 'OTP must be exactly 5 digits',
    })

    otpCode: string

}