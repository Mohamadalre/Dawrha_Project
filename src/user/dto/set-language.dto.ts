import { IsEnum } from 'class-validator';
import { Language } from '@src/common/enums/language.enum';

/** The account's chosen response language. */
export class SetLanguageDto {
  @IsEnum(Language, { message: 'language must be one of: en, ar' })
  language: Language;
}
