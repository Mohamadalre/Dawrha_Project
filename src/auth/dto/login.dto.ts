import { IsEmail, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, MinLength } from 'class-validator';


export class LoginDto {
  @IsNotEmpty()
  @IsString() 
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  deviceType?: string;
  
  @IsOptional()
  @IsString()
  fcmToken?: string;
}