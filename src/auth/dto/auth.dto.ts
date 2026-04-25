import { DeviceType } from '@src/user/enums/deviec-type.enum';
import { Role } from '@src/user/enums/role.enum';
import {  IsEnum, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, MinLength } from 'class-validator';


export class RefreshTokenDto {
  @IsNotEmpty()
  @IsString()
  refreshToken: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}






export class DeviceDto {
  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsEnum(DeviceType)
  deviceType?:DeviceType ;
  
  @IsOptional()
  @IsString()
  fcmToken?: string;
}
