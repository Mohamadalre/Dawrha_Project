import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Matches, MaxLength, MinLength } from 'class-validator';


export class CreateAccountDto {
 

  @IsNotEmpty()
  @IsEmail()
  email:string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  password: string;

  @IsNotEmpty()
  @Matches(/^(\+?963|0)?9\d{8}$/,{
    message:"The phone number must be a Syrian number"
  })
  phone:string;


  

}
