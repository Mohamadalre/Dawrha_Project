import { DeviceType } from '@src/user/enums/deviec-type.enum';
import { IsEnum, IsNotEmpty, IsOptional, IsString ,IsBoolean } from 'class-validator';


// RefreshTokenDto removed: the refresh route takes no body — the device id is
// read from the refresh token's verified payload by RefreshTokenGuard.

export class RefreshTokenTemporaryDto {
  @IsString()
  token: string
}

export class DeviceDto {

  @IsString()
  @IsNotEmpty({ message: 'The Device ID is required' })
  deviceId: string;

  @IsOptional()
  @IsEnum(DeviceType)
  deviceType?: DeviceType;

  @IsOptional()
  @IsString()
  fcmToken?: string;

  @IsBoolean()
  @IsOptional()
  rememberMy: boolean
}
