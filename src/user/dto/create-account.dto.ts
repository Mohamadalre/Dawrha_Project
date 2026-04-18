import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Matches, MaxLength, MinLength } from 'class-validator';


export class CreateAccountDto {
 
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  password: string;

  @IsNotEmpty()
  @IsEmail()
  email:string;

  @IsNotEmpty()
  @Matches(/^(\+?963|0)?9\d{8}$/,{
    message:"The phone number must be a Syrian number"
  })
  phone:string;


  

}
