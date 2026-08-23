import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * A full ISO 8601 datetime that CARRIES an explicit timezone designator —
 * either `Z` or a `±HH:MM` offset. Date-only (`2026-06-15`) and offset-less
 * local datetimes (`2026-06-15T23:59:00`) are rejected.
 */
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Requires a timezone-qualified ISO 8601 datetime.
 *
 * Unlike `@IsDateString()`, this REFUSES a value with no offset. That refusal is
 * deliberate for money-affecting fields (pricing/offer validity): an offset-less
 * string is ambiguous — `new Date("2026-06-15T23:59:00")` is read in the SERVER
 * process's timezone (UTC in production), so an admin who meant a local wall
 * clock would silently mis-expire the price by the UTC offset. Rejecting it turns
 * that latent drift into a loud 400 the caller must fix, instead of a quiet
 * money bug. The client must send e.g. `2026-06-15T23:59:00+03:00` or `...Z`.
 *
 * `null` / `undefined` pass straight through (pair with `@IsOptional()` for a
 * clearable field); only a present, malformed string fails.
 */
export function IsIsoDateTimeWithOffset(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isIsoDateTimeWithOffset',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (value === null || value === undefined) return true;
          if (typeof value !== 'string') return false;
          if (!ISO_WITH_OFFSET.test(value)) return false;
          return Number.isFinite(Date.parse(value));
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be an ISO 8601 datetime WITH a timezone offset (e.g. 2026-06-15T23:59:00+03:00 or 2026-06-15T20:59:00Z)`;
        },
      },
    });
  };
}
