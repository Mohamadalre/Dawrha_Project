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
