import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Editable fields of the Odoo admin account.
 *
 * `login` and `password` ARE the credentials the backend authenticates to Odoo
 * with. Changing them here updates Odoo, the running connection AND the `.env`
 * in one step (see OdooService.updateAdminCredentials), so the connection never
 * breaks — send them only when you intend to rotate the credentials.
 */
export class UpdateOdooAdminDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  /** The Odoo login (username). Rotating it updates Odoo + connection + .env. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  login?: string;

  /** The Odoo password. Rotating it updates Odoo + connection + .env. */
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(100)
  password?: string;
}
