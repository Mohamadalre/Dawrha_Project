import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { DeviceDto } from './auth.dto';


export class LoginGoogleDto extends DeviceDto {

    @IsNotEmpty({ message: 'The TokenId is required' })
    @IsString()
    TokenId: string;

    /**
     * Phone the client collected during Google sign-up.
     *
     * Google's ID token carries email/name/picture only — never a phone — so a
     * phone that should be stored has to arrive on the request. Optional because
     * login never needs it and citizens may sign up without one; validated and
     * checked for uniqueness in `registerWithGoogle` when present.
     */
    @IsOptional()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @Matches(/^\+?\d{7,15}$/, { message: 'Invalid phone number format' })
    phone?: string;
}