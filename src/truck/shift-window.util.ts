import { Shift } from '@src/shift/entities/shift.entity';

/**
 * Resolves a shift's concrete start/end datetimes for the day that contains
 * `now`, plus its grace tolerance (minutes). Handles shifts that cross midnight
 * (end <= start → end rolls to the next day). Shared by the handover service
 * (pickup/dropoff guards) and the handover crons (missed pickup / late dropoff).
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

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function resolveShiftWindow(shift: Shift, now: Date = new Date()): ShiftWindow {
  const [sh, sm, ss] = parseHms(shift.startTime);
  const [eh, em, es] = parseHms(shift.endTime);

  const start = new Date(now);
  start.setHours(sh, sm, ss, 0);

  const end = new Date(now);
  end.setHours(eh, em, es, 0);
  // Overnight shift (e.g. 22:00 → 06:00): the end belongs to the next day.
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);

  const toleranceMs = Math.max(0, shift.tolerance || 0) * 60 * 1000;
  return { start, end, toleranceMs, workDate: ymd(start) };
}
