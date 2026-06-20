import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from "class-validator";


export class ForgotPasswordDto {
  @IsNotEmpty({ message: 'The email is required' })
  @IsString()
  email: string;
}


export class ResetPasswordDto {

  @IsNotEmpty({ message: 'The resetTicket is required' })
  @IsString()
  resetTicket: string;

  @IsNotEmpty({ message: 'The email is required' })
  @IsEmail()
  email: string;

  @IsNotEmpty({ message: 'The new password is required ' })
  @IsString()
  @MinLength(8, { message: 'The password is very short(minimum 8 characters' })
  @MaxLength(64, { message: 'The password is very long(maximum 64 characters' })
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message: 'A weak password should contain uppercase and lowercase letters,numbers,or symbols',
  })
  newPassword: string;

  @IsNotEmpty({ message: 'The confirm password is required ' })
  @IsString()
  @MinLength(8, { message: 'The password is very short(minimum 8 characters' })
  @MaxLength(64, { message: 'The password is very long(maximum 64 characters' })
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message: 'A weak password should contain uppercase and lowercase letters,numbers,or symbols',
  })
  confirmPassword: string;
}