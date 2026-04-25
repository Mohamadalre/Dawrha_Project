import { IsNotEmpty,IsString,MaxLength,MinLength } from "class-validator";


export class ForgotPasswordDto {
  @IsNotEmpty() 
  @IsString()
  email: string;
}


export class ResetPasswordDto {

  @IsNotEmpty()
  @IsString()
  tokenUrl: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  newPassword: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  confirmPassword: string;
}