// Export helpers that need the plan, the runs and a date range: the range from a preset or custom dates,
// and the planned-vs-actual CSV (one row per planned workout, plus one per run that matches no workout).
import { addDays, weekdayOf } from './dates.js';
import { weeksInRange } from './aiExport.js';
import { clipWeeks, inRange } from './rangeUtil.js';
import { compareRun, workoutStatus } from './tracking.js';
import { formatPace } from './units.js';

/** @param {'all'|'recent'|'custom'} preset  @param {{from?:string,to?:string}} [custom] */
export function resolveRange(plan, today, preset, custom = {}) {
  if (preset === 'custom') {
    let from = custom.from || null;
    let to = custom.to || null;
    if (from && to && from > to) [from, to] = [to, from];
    return from || to ? { from, to } : null;
  }
  if (preset === 'recent' && plan) {
    const ws = weeksInRange(plan, today, 'recent');
    if (ws.length) return { from: ws[0].start, to: addDays(ws.at(-1).start, 6) };
  }
  return null;
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const r1 = (v) => Math.round(v * 10) / 10;

export const ACTUAL_CSV_HEADER = ['date', 'weekday', 'week', 'phase', 'code', 'name', 'planned_km', 'planned_min', 'planned_climb_m', 'status',
  'actual_km', 'actual_min', 'actual_pace_per_km', 'actual_avg_hr', 'actual_max_hr', 'actual_climb_m', 'indoor', 'race', 'diff_min', 'diff_km', 'diff_climb_m'];

export function actualCsv(plan, runs, { today, mode, range = null }) {
  const trail = mode === 'trail';
  const rows = [];
  const byWorkout = new Map();
  for (const r of runs) if (r.matchedWorkoutId && !byWorkout.has(r.matchedWorkoutId)) byWorkout.set(r.matchedWorkoutId, r);
  const used = new Set();
  const runCells = (r) => [r1(r.distanceKm), r1(r.movingSec / 60), r.avgPaceSecPerKm ? formatPace(r.avgPaceSecPerKm) : '', r.avgHr ? Math.round(r.avgHr) : '', r.maxHr ? Math.round(r.maxHr) : '', Math.round(r.gainM ?? 0), r.indoor ? 'yes' : '', r.race ? 'yes' : ''];
  const blankRun = ['', '', '', '', '', '', '', ''];

  for (const week of clipWeeks(plan?.weeks ?? [], range)) {
    for (const w of week.workouts) {
      const run = byWorkout.get(w.id) ?? null;
      if (run) used.add(run);
      const status = workoutStatus(w, run, today);
      const cmp = run && w.role !== 'S' ? compareRun(w, run) : null;
      rows.push([w.date, w.weekday, week.n, week.phase, w.code, w.name, trail ? '' : w.plannedKm ?? '', w.plannedMin, w.plannedVertM || '', status,
        ...(run ? runCells(run) : blankRun), cmp?.minDiff ?? '', cmp?.kmDiff ?? '', cmp?.vertDiff ?? '']);
    }
  }
  const weekOf = (d) => (plan?.weeks ?? []).find((w) => d >= w.start && d <= addDays(w.start, 6));
  for (const r of runs) {
    if (used.has(r) || !inRange(r.date, range)) continue;
    const wk = weekOf(r.date);
    rows.push([r.date, weekdayOf(r.date), wk?.n ?? '', wk?.phase ?? '', '', 'Unplanned or unmatched run', '', '', '', 'unplanned', ...runCells(r), '', '', '']);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return [ACTUAL_CSV_HEADER, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
