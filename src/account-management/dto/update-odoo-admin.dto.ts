import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Editable fields of the Odoo admin account — PROFILE ONLY: name, email, phone.
 *
 * The credentials (`login` / `password`) are deliberately NOT editable here.
 * They are how the backend authenticates to Odoo, and this route is for keeping
 * the admin's contact details in step across the two systems — not a place to
 * rotate the connection password from a routine profile edit.
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
}

/**
 * Create an ADDITIONAL Odoo admin account from the backend (invite model).
 *
 * No password field — deliberately. The backend creates the account and Odoo
 * emails the new admin a link to set their OWN password, so no admin secret ever
 * passes through or is stored on the backend. `login` is the Odoo username and
 * must be unique.
 */
/**
 * Rotate the CONNECTED Odoo admin's sign-in credentials — the login and/or
 * password used to sign into the Odoo page (and the same credentials the backend
 * authenticates to Odoo with).
 *
 * Kept SEPARATE from the profile edit on purpose: a routine name/email change
 * must never risk the connection, whereas this endpoint exists precisely to
 * change it — deliberately, with its own permission. The service writes to Odoo,
 * RE-AUTHENTICATES to prove the new credentials work, and only then persists them
 * to `.env` (see OdooService.updateAdminCredentials), so the backend can never
 * lock itself out. At least one of the two fields must be provided.
 */
export class UpdateOdooAdminCredentialsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  login?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password?: string;
}

export class CreateOdooAdminDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  login: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}
