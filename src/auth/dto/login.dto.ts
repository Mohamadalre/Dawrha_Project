import { IsEmail, IsNotEmpty, IsString ,MinLength,MaxLength} from 'class-validator';
import { DeviceDto } from './auth.dto';


export class LoginDto extends DeviceDto {
  @IsNotEmpty()
  @IsString()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  password: string;


}