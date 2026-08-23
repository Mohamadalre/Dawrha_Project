/**
 * Operation-timezone helpers.
 *
 * Some values in the system are WALL-CLOCK, not absolute instants: a shift's
 * "08:00", or the minutes-of-day a driver is judged on-shift by. Those must be
 * read in the OPERATION's timezone — never in the server process's timezone,
 * which on a Docker/production box is UTC and would shift every such value by
 * the UTC offset (the bug where a driver inside his shift was told it had not
 * started).
 *
 * These helpers resolve wall-clock values in {@link OPERATION_TIMEZONE} using
 * the platform `Intl` timezone database, with no global `TZ` change and no third
 * -party dependency. Absolute instants (timestamptz columns, `NOW()`, Date.now)
 * are unaffected by any of this and must NOT be routed through here.
 */

/**
 * IANA timezone the operation's wall-clock values are expressed in. Defaults to
 * Asia/Damascus; override with OPERATION_TIMEZONE for another region.
 */
export const OPERATION_TIMEZONE = process.env.OPERATION_TIMEZONE || 'Asia/Damascus';

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock reading (year…second) of an instant in `timeZone`. */
export function partsInZone(instant: Date, timeZone: string = OPERATION_TIMEZONE): ZonedParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10);
  }
  // Some ICU builds emit hour "24" at midnight — normalise to 0.
  if (map.hour === 24) map.hour = 0;
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

/** UTC offset (ms; local = utc + offset) of `timeZone` at a given instant. */
export function zoneOffsetMs(instant: Date, timeZone: string = OPERATION_TIMEZONE): number {
  const p = partsInZone(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant.getTime();
}

/**
 * The absolute instant of a wall-clock date+time read in `timeZone`. One
 * refinement pass resolves the rare DST-boundary case where the offset at the
 * naive guess differs from the offset at the resolved instant. Date.UTC absorbs
 * day overflow (e.g. day 32 → next month), so callers can roll a day with +1.
 */
export function zonedWallClockToInstant(
  p: ZonedParts,
  timeZone: string = OPERATION_TIMEZONE,
): Date {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset1 = zoneOffsetMs(new Date(guess), timeZone);
  let instant = guess - offset1;
  const offset2 = zoneOffsetMs(new Date(instant), timeZone);
  if (offset2 !== offset1) instant = guess - offset2;
  return new Date(instant);
}

/**
 * Minutes since midnight as read in `timeZone` (seconds folded in as a
 * fraction). The correct basis for "is now inside this shift's HH:MM window".
 */
export function minutesOfDayInZone(instant: Date, timeZone: string = OPERATION_TIMEZONE): number {
  const p = partsInZone(instant, timeZone);
  return p.hour * 60 + p.minute + p.second / 60;
}

/** The instant of 00:00:00 on `instant`'s calendar day, read in `timeZone`. */
export function startOfDayInZone(instant: Date, timeZone: string = OPERATION_TIMEZONE): Date {
  const p = partsInZone(instant, timeZone);
  return zonedWallClockToInstant({ ...p, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** The instant of 00:00:00 on the FIRST day of `instant`'s month, in `timeZone`. */
export function startOfMonthInZone(instant: Date, timeZone: string = OPERATION_TIMEZONE): Date {
  const p = partsInZone(instant, timeZone);
  return zonedWallClockToInstant({ ...p, day: 1, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** `instant`'s calendar day as YYYY-MM-DD, read in `timeZone`. */
export function dateStringInZone(instant: Date, timeZone: string = OPERATION_TIMEZONE): string {
  const p = partsInZone(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
