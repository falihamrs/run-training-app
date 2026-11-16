// Calendar export: the plan as an iCalendar (.ics) file with one all-day event per workout.
import { addDays } from './dates.js';
import { workoutText } from './export.js';
import { clipWeeks } from './rangeUtil.js';

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const day = (iso) => iso.replace(/-/g, '');

// RFC 5545: lines are at most 75 octets; longer ones continue on the next line after a space.
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function eventTitle(w, trail) {
  const size = w.role === 'RACE' ? '' : ` · ${w.plannedMin} min${trail && w.plannedVertM ? ` · ${w.plannedVertM} m` : ''}${!trail && w.plannedKm ? ` · ${w.plannedKm} km` : ''}`;
  return `${w.role === 'RACE' ? 'RACE: ' : ''}${w.name}${size}`;
}

/**
 * @param {object} plan
 * @param {object} ctx      same context as the text export (thresholds, zones, mode)
 * @param {object} [o]
 * @param {{from:string|null,to:string|null}|null} [o.range]
 * @param {string} [o.stamp] UTC timestamp for DTSTAMP, e.g. 20261116T120000Z
 */
export function planIcs(plan, ctx, { range = null, stamp = '19700101T000000Z' } = {}) {
  const trail = plan.mode === 'trail';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Run Training Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Run training plan'];
  for (const week of clipWeeks(plan.weeks, range)) {
    for (const w of week.workouts) {
      const body = workoutText(w, ctx, week);
      lines.push('BEGIN:VEVENT', `UID:${w.date}-${w.role}-${w.code}@run-training-planner`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${day(w.date)}`, `DTEND;VALUE=DATE:${day(addDays(w.date, 1))}`,
        `SUMMARY:${esc(eventTitle(w, trail))}`, `DESCRIPTION:${esc(body)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
