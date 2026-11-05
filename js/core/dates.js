// Calendar dates are local "YYYY-MM-DD" strings. Plan dates are never timestamps,
// so daylight-saving changes cannot shift a workout by a day.

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

export function isValidDate(s) {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function toUtcMs(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms) {
  const dt = new Date(ms);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(s, n) {
  return fromUtcMs(toUtcMs(s) + n * DAY_MS);
}

/** Whole days from a to b (positive when b is later). */
export function diffDays(a, b) {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

export function weekdayOf(s) {
  const dow = new Date(toUtcMs(s)).getUTCDay(); // 0 = Sunday
  return WEEKDAYS[(dow + 6) % 7];
}

export function mondayOnOrBefore(s) {
  const idx = WEEKDAYS.indexOf(weekdayOf(s));
  return addDays(s, -idx);
}

/** First Monday strictly after the given date. */
export function nextMonday(s) {
  const idx = WEEKDAYS.indexOf(weekdayOf(s));
  return addDays(s, 7 - idx);
}

/** Today's date in the browser's local time zone. */
export function todayLocal(now = new Date()) {
  const y = String(now.getFullYear()).padStart(4, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local calendar date of a UTC millisecond timestamp, given the zone offset in minutes east of UTC. */
export function localDateOfMs(ms, tzOffsetMin = 0) {
  return fromUtcMs(Math.floor((ms + tzOffsetMin * 60000) / DAY_MS) * DAY_MS);
}
