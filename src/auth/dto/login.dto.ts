import { IsEmail, IsNotEmpty, IsString ,MinLength,MaxLength,} from 'class-validator';
import { DeviceDto } from './auth.dto';


export class LoginDto extends DeviceDto  {
  @IsNotEmpty({message:'The email is required'})
  @IsString()
  @IsEmail()
  email: string;


  @IsNotEmpty({message:'The password is required '})
  @IsString()
  @MinLength(8, { message:'The password is very short(minimum 8 characters'})
  @MaxLength(64, { message: 'The password is very long(maximum 64 characters' })
  password: string;








}