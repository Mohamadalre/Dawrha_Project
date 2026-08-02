import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { InformationInstitutionDto } from './institutions-onboarding.dto';
import { InformationFactoryDto } from './factory-onboarding.dto';
import { InformationExternalPartnerDto } from './external-partner-onboarding.dto';
import {
  UpdateInformationExternalPartnerDto,
  UpdateInformationFactoryDto,
  UpdateInformationInstitutionDto,
} from './update-information.dto';

/**
 * One phone rule, applied everywhere a phone is accepted.
 *
 * Two things this pins down, both of which were wrong.
 *
 * The institution asked for a LANDLINE alongside a mobile. Two columns for one
 * answer are two places to look and one of them is always the wrong one: the
 * number that matters is the one a driver at a locked gate can ring, and a
 * building's switchboard is not it outside office hours.
 *
 * And the EDIT DTOs used `@IsMobilePhone('ar-SY')` with no normalisation — a
 * different and looser rule than first submission. So the edit screen accepted
 * numbers the application form had rejected, and stored them in whatever shape
 * they were typed. A number entered as `09xx` at creation and `+9639xx` at edit
 * became two different strings for one phone, and since the uniqueness check
 * compares strings, the second no longer collided with anything.
 *
 * "An applicant must not be able to weaken their own data by editing it" was
 * this file's stated rule; it held for every field except the one a driver has
 * to ring.
 */
const errorsOn = (cls: any, payload: Record<string, unknown>, field: string) => {
  const dto = plainToInstance(cls, payload);
  return validateSync(dto as object).filter((e) => e.property === field);
};

const valueOf = (cls: any, payload: Record<string, unknown>, field: string) =>
  (plainToInstance(cls, payload) as any)[field];

// Every DTO that accepts a phone, and the field it accepts it under.
const CREATE: [string, any][] = [
  ['institution', InformationInstitutionDto],
  ['factory', InformationFactoryDto],
  ['free facility', InformationExternalPartnerDto],
];
const EDIT: [string, any][] = [
  ['institution', UpdateInformationInstitutionDto],
  ['factory', UpdateInformationFactoryDto],
  ['free facility', UpdateInformationExternalPartnerDto],
];

describe('the phone rule is the same everywhere', () => {
  describe.each([...CREATE, ...EDIT])('%s', (_name, cls) => {
    it('accepts a Syrian mobile', () => {
      expect(errorsOn(cls, { phoneNumber: '963931234567' }, 'phoneNumber')).toHaveLength(0);
    });

    it('refuses a landline', () => {
      // `011…` is the shape the institution used to REQUIRE. It must now fail
      // everywhere, including on the edit path that once accepted it.
      expect(
        errorsOn(cls, { phoneNumber: '0113456789' }, 'phoneNumber').length,
      ).toBeGreaterThan(0);
    });

    it('refuses a number that is not Syrian', () => {
      expect(
        errorsOn(cls, { phoneNumber: '447700900000' }, 'phoneNumber').length,
      ).toBeGreaterThan(0);
    });

    it.each([
      ['0931234567', '963931234567'],
      ['+963931234567', '963931234567'],
      ['00963931234567', '963931234567'],
      [' 963931234567 ', '963931234567'],
    ])('normalises %s to one stored form', (typed, stored) => {
      // The uniqueness check compares STRINGS. Without this, the same phone
      // typed two ways is two rows, and the second collides with nothing.
      expect(valueOf(cls, { phoneNumber: typed }, 'phoneNumber')).toBe(stored);
      expect(errorsOn(cls, { phoneNumber: typed }, 'phoneNumber')).toHaveLength(0);
    });
  });
});

/**
 * Validated with the options `main.ts` actually installs. `forbidNonWhitelisted`
 * is what turns a field the DTO no longer declares into a 400 rather than a
 * value quietly ignored, and testing without it would describe a stricter
 * runtime than the one that exists — or a laxer one.
 */
const APP_VALIDATION = { whitelist: true, forbidNonWhitelisted: true } as const;

describe('the institution landline is gone', () => {
  it('is REFUSED by the create route, not quietly ignored', () => {
    // Not merely optional — absent. An optional landline is still a second
    // place for the answer to live, and something will write to it.
    const errors = validateSync(
      plainToInstance(InformationInstitutionDto, {
        institutionName: 'مؤسسة',
        licenseNumber: 'L-1',
        phoneNumber: '963931234567',
        landlinePhone: '0113456789',
      }) as object,
      APP_VALIDATION,
    );

    expect(errors.map((e) => e.property)).toContain('landlinePhone');
  });

  it('is refused by the edit route too', () => {
    const errors = validateSync(
      plainToInstance(UpdateInformationInstitutionDto, {
        landlinePhone: '0113456789',
      }) as object,
      APP_VALIDATION,
    );

    expect(errors.map((e) => e.property)).toContain('landlinePhone');
  });

  it('still accepts the same submission without it', () => {
    // The refusal above must come from the landline alone — otherwise the test
    // would pass on any broken payload.
    const errors = validateSync(
      plainToInstance(InformationInstitutionDto, {
        institutionName: 'مؤسسة',
        licenseNumber: 'L-1',
        phoneNumber: '963931234567',
      }) as object,
      APP_VALIDATION,
    );

    expect(errors).toHaveLength(0);
  });
});
