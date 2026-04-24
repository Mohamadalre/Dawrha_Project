import { IsEmail, IsNotEmpty,IsString  } from 'class-validator';
import { DeviceDto } from './auth.dto';


export class LoginDto extends DeviceDto{
  @IsNotEmpty()
  @IsString() 
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  password: string;


}