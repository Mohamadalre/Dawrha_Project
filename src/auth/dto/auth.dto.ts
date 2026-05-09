import { DeviceType } from '@src/user/enums/deviec-type.enum';
import {  IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';


export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty({message:'The Device ID is required'})
  deviceId: string;
}

export class RefreshTokenTemporaryDto {
@IsString()
token:string
}

export class DeviceDto {

  @IsString()
  @IsNotEmpty({message:'The Device ID is required'})
  deviceId: string;

  @IsOptional()
  @IsEnum(DeviceType)
  deviceType?:DeviceType ;
  
  @IsOptional()
  @IsString()
  fcmToken?: string;
}
