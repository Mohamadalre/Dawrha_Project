import { IsNotEmpty, IsNumber, Max, Min } from "class-validator";

export class VerifyOtpDto {
    @IsNotEmpty()
    @IsNumber()
    @Min(5)
    @Max(5)
    otpCode: number

}