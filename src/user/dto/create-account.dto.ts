import { normalizeSyrianPhoneNumber } from '@src/common/utils/phone-normalization.provider';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';


export class CreateAccountDto {
 

  // Trailing space removed: the message doubles as the i18n KEY, so a stray
  // space is a translation that silently stops matching the moment anyone
  // retypes the sentence without it.
  @IsNotEmpty({ message: 'The email is required' })
  @IsEmail({})
  email:string;

  @IsNotEmpty({message:'The password is required '})
  @IsString()
  @MinLength(8, { message:'The password is very short(minimum 8 characters'})
  @MaxLength(64, { message: 'The password is very long(maximum 64 characters' })
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message: 'A weak password should contain uppercase and lowercase letters,numbers,or symbols',
  })
  password: string;

  @IsNotEmpty({message:'The phone number is required'})
  @IsString()
  @Transform(({ value }) => normalizeSyrianPhoneNumber(value)) 
  @Matches(/^9639[3-9][0-9]{7}$/, {
    message: 'The phone number must be a Syrian number',
  })
  phoneNumber: string;


  

}
