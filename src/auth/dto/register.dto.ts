import { IsNotEmpty, IsOptional, IsString, Length, } from 'class-validator';
import { CreateAccountDto } from '../../user/dto/create-account.dto';



export class RegisterDto extends CreateAccountDto {

  @IsString()
  @IsNotEmpty({ message: 'The  Full name is required' })
  @Length(3, 40)
  fullName: string;


}
