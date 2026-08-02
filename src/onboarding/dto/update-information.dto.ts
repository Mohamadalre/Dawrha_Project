import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { normalizeSyrianPhoneNumber } from '@src/common/utils/phone-normalization.provider';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

/**
 * Editing the "information" step of an application that is still awaiting a
 * decision. One DTO per role — the fields differ completely, and a shared
 * loose DTO would let a factory post institution fields.
 *
 * Every field is optional (PATCH semantics), but a field that IS sent must pass
 * the same validation as on first submission: an applicant must not be able to
 * weaken their own data by editing it.
 */

/**
 * The phone rule, written ONCE, identical to the one the create DTOs use.
 *
 * These fields used to be `@IsMobilePhone('ar-SY')` with no normalisation,
 * which is a different and looser rule than first submission — so the edit
 * screen accepted numbers the application form had rejected, and stored them
 * in whatever shape they were typed. Two consequences, both silent: a number
 * entered as `09xx` at creation and `+9639xx` at edit became two different
 * strings for one phone, and the uniqueness check compares strings, so the
 * second one no longer collides with anything.
 *
 * "Cannot weaken their own data by editing it" was the stated rule of this
 * file; it was true of every field except the one a driver has to ring.
 */
const IsSyrianMobile = () =>
  applyDecorators(
    Transform(({ value }) => normalizeSyrianPhoneNumber(value)),
    Matches(/^9639[3-9][0-9]{7}$/, {
      message: 'The phone number must be a Syrian number',
    }),
  );

export class UpdateInformationInstitutionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  institutionName?: string;

  @IsOptional()
  @IsUUID()
  institutionTypeId?: string;

  @IsOptional()
  @IsString()
  otherInstitutionType?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  licenseNumber?: string;

  @IsOptional()
  @IsString()
  taxNumber?: string;

  /**
   * The institution's mobile — the only number, and editable on purpose: an
   * application sent back for changes is often sent back BECAUSE the number
   * was wrong.
   */
  @IsOptional()
  @IsSyrianMobile()
  phoneNumber?: string;
}

export class UpdateInformationFactoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  factoryName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  commercialRecord?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  industrialRecord?: string;

  @IsOptional()
  @IsString()
  taxNumber?: string;

  @IsOptional()
  @IsSyrianMobile()
  phoneNumber?: string;
}

export class UpdateInformationExternalPartnerDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  externalPartnerName?: string;

  /** Mobile — the number a person answers, and the facility's only number now.
   *  Editable because a facility sent back for changes is often sent back
   *  BECAUSE the number was wrong. */
  @IsOptional()
  @IsSyrianMobile()
  phoneNumber?: string;
}

export class UpdateInformationCollectorDto {
  /** Exactly 11 digits — same rule as on submission. */
  @IsOptional()
  @Matches(/^\d{11}$/, { message: 'National ID must be exactly 11 digits' })
  NationalID?: string;

  /** The driver shift he applies for (must be a global driver shift). */
  @IsOptional()
  @IsUUID()
  shiftId?: string;
}
