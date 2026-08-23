import { Shift } from '@src/shift/entities/shift.entity';
import {
  OPERATION_TIMEZONE,
  partsInZone,
  zonedWallClockToInstant,
} from '@src/common/time/operation-time.util';

/**
 * Resolves a shift's concrete start/end datetimes for the day that contains
 * `now`, plus its grace tolerance (minutes). Handles shifts that cross midnight
 * (end <= start → end rolls to the next day). Shared by the handover service
 * (pickup/dropoff guards) and the handover crons (missed pickup / late dropoff).
 *
 * Shift times (e.g. "08:00") are WALL-CLOCK times in the operation's timezone,
 * authored in Odoo. They are interpreted here in {@link OPERATION_TIMEZONE} —
 * NOT in the server process's timezone — so a UTC server (Docker/production) no
 * longer shifts the window by its UTC offset. That offset was the reason a
 * driver inside his shift was told the shift had not started yet.
 */
export interface ShiftWindow {
  start: Date;
  end: Date;
  toleranceMs: number;
  /** The shift day as YYYY-MM-DD (the calendar day of `start`). */
  workDate: string;
}

function parseHms(t: string): [number, number, number] {
  const [h = 0, m = 0, s = 0] = (t || '0:0:0').split(':').map((n) => parseInt(n, 10) || 0);
  return [h, m, s];
}

export function resolveShiftWindow(shift: Shift, now: Date = new Date()): ShiftWindow {
  const [sh, sm, ss] = parseHms(shift.startTime);
  const [eh, em, es] = parseHms(shift.endTime);

  // "Today" as read in the operation's timezone (not the server's) — this is the
  // shift's calendar day, and the anchor both ends hang off.
  const today = partsInZone(now, OPERATION_TIMEZONE);

  const start = zonedWallClockToInstant(
    { ...today, hour: sh, minute: sm, second: ss },
    OPERATION_TIMEZONE,
  );
  let end = zonedWallClockToInstant(
    { ...today, hour: eh, minute: em, second: es },
    OPERATION_TIMEZONE,
  );
  // Overnight shift (e.g. 22:00 → 06:00): the end belongs to the next day.
  if (end.getTime() <= start.getTime()) {
    end = zonedWallClockToInstant(
      { ...today, day: today.day + 1, hour: eh, minute: em, second: es },
      OPERATION_TIMEZONE,
    );
  }

  const toleranceMs = Math.max(0, shift.tolerance || 0) * 60 * 1000;
  const workDate = `${today.year}-${String(today.month).padStart(2, '0')}-${String(
    today.day,
  ).padStart(2, '0')}`;
  return { start, end, toleranceMs, workDate };
}
