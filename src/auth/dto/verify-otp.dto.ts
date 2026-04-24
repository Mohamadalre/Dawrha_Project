import { IsNotEmpty, IsNumber, Length } from "class-validator";

export class VerifyOtpDto{
    @IsNumber()
    @IsNotEmpty()
    @Length(5,5)
    otpCode:string

}