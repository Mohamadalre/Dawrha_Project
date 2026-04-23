import { IsNotEmpty, IsOptional, IsString, Length,  } from 'class-validator';
import { CreateAccountDto } from '../../user/dto/create-account.dto';

export class RegisterCitizenDto extends CreateAccountDto {

  @IsString()
  @IsNotEmpty()
  @Length(3,40)
  fullName: string;

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
