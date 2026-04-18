import { IsOptional, IsString,  } from 'class-validator';
import { CreateAccountDto } from '../../user/dto/create-account.dto';

export class RegisterDto extends CreateAccountDto {
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
