import { IsNotEmpty, IsOptional, IsString, Length,  } from 'class-validator';
import { CreateAccountDto } from '../../user/dto/create-account.dto';
import { DeviceDto } from './auth.dto';
import { IntersectionType } from '@nestjs/mapped-types';

export class RegisterDto extends IntersectionType(CreateAccountDto,DeviceDto){

  @IsString()
  @IsNotEmpty()
  @Length(3,40)
  fullName: string;


}
