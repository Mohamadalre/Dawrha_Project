import { BadRequestException } from '@nestjs/common';
import { IsEnum, IsString, Matches } from 'class-validator';
import { Weekday } from '@src/user/enums/weekday.enum';

/** 24-hour HH:mm, e.g. "08:00" or "17:30". */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One detailed delivery window a factory can receive an order in: a weekday and
 * a start→end time. A factory sends an array of these (the "detailed delivery
 * times" that replaced the old single morning/afternoon/evening choice).
 *
 * The from < to check is enforced in the DTO holding the array, because it
 * needs both ends of the same slot.
 */
export class DeliveryTimeSlotDto {
  @IsEnum(Weekday, { message: 'day must be a valid weekday' })
  day: Weekday;

  @IsString()
  @Matches(HHMM, { message: 'from must be a 24-hour HH:mm time' })
  from: string;

  @IsString()
  @Matches(HHMM, { message: 'to must be a 24-hour HH:mm time' })
  to: string;
}

/**
 * The per-field shape is validated by the DTO; this adds the one rule that
 * needs both ends of the same slot — a window must start before it ends.
 * Shared by the factory add step and its edit so both reject "17:00 → 09:00"
 * the same way.
 */
export function assertValidTimeSlots(slots?: DeliveryTimeSlotDto[] | null): void {
  if (!slots) return;
  for (const s of slots) {
    if (s.from >= s.to) {
      throw new BadRequestException('A delivery time window must start before it ends');
    }
  }
}
