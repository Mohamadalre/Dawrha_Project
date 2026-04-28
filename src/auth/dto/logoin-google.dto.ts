import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength, IsEnum } from 'class-validator';
import { DeviceDto } from './auth.dto';
import { Role } from '@src/user/enums/role.enum';

export class LoginGoogleDto extends DeviceDto {

    @IsNotEmpty({ message: 'The TokenId is required' })
    @IsString()
    Tokenid: string;
}