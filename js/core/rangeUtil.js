// Date ranges for exports. A range is null (everything) or { from, to } with ISO dates; either end may be null (open).
import { addDays } from './dates.js';

export const inRange = (date, r) => !r || ((!r.from || date >= r.from) && (!r.to || date <= r.to));

/** Weeks that overlap the range, each with only the workouts inside it. */
export function clipWeeks(weeks, r) {
  if (!r) return weeks;
  return weeks
    .filter((w) => (!r.from || addDays(w.start, 6) >= r.from) && (!r.to || w.start <= r.to))
    .map((w) => ({ ...w, workouts: w.workouts.filter((x) => inRange(x.date, r)) }));
}

/** Short text for file names and headings, e.g. "2026-10-01 to 2026-11-15". */
export function rangeLabel(r) {
  if (!r) return 'whole plan';
  return `${r.from ?? 'start'} to ${r.to ?? 'end'}`;
}
