import { IsEnum, IsString } from 'class-validator';
import { Language } from '@src/common/enums/language.enum';

/** Body for changing the notification language of the caller's device. */
export class UpdateDeviceLanguageDto {
  @IsString()
  deviceId: string;

  @IsEnum(Language)
  language: Language;
}
