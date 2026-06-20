import { IsNotEmpty, IsString} from 'class-validator';
import { DeviceDto } from './auth.dto';


export class LoginGoogleDto extends DeviceDto {

    @IsNotEmpty({ message: 'The TokenId is required' })
    @IsString()
    TokenId: string;
}