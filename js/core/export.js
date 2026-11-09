// Section 9 outputs: Coros-friendly text and CSV. Targets are written as ranges that can be
// typed into the Coros app as pace or heart-rate targets.
import { WEEKDAYS } from './dates.js';
import { resolveTargets } from './targets.js';
import { formatPace } from './units.js';

const dur = (p) => {
  if (p.durationSec != null) return p.durationSec >= 60 && p.durationSec % 60 === 0 ? `${p.durationSec / 60} min` : `${p.durationSec} s`;
  const m = p.durationMin ?? 0;
  return Number.isInteger(m) ? `${m} min` : `${Math.floor(m)} min ${Math.round((m % 1) * 60)} s`;
};

const paceTxt = (p) => {
  if (!p || (p.fast == null && p.slow == null)) return null;
  if (p.slow == null) return `slower than ${formatPace(p.fast)}/km`;
  if (p.fast == null) return `faster than ${formatPace(p.slow)}/km`;
  return `${formatPace(p.fast)}–${formatPace(p.slow)}/km`;
};
const hrTxt = (h) => {
  if (!h || (h.lo == null && h.hi == null)) return null;
  if (h.lo == null) return `below ${h.hi} bpm`;
  if (h.hi == null) return `above ${h.lo} bpm`;
  return `${h.lo}–${h.hi} bpm`;
};

export function targetText(t, { trail = false } = {}) {
  if (!t) return '';
  const pace = paceTxt(t.pace);
  const hr = hrTxt(t.hr);
  const rpe = trail && t.rpe ? `RPE ${t.rpe}` : null;
  const parts = [];
  if (t.hrInfoOnly) {
    if (pace) parts.push(pace);
    if (hr) parts.push(`HR about ${hr}, for information`);
  } else {
    if (pace) parts.push(pace);
    if (hr) parts.push(hr);
  }
  if (rpe) parts.push(rpe);
  return parts.join(', ') || (t.zone ? `zone ${t.zone}` : '');
}

const LABEL = { warmup: 'Warm-up', cooldown: 'Cool-down', easy: 'Easy', steady: 'Steady', work: 'Work', strides: 'Strides' };

export function stepLines(steps, { trail = false } = {}) {
  const lines = [];
  for (const s of steps) {
    if (s.kind === 'exercise') { lines.push(`${s.name}: ${s.sets} × ${s.reps}`); continue; }
    if (s.kind === 'repeat') {
      const w = targetText(s.workTarget, { trail });
      const r = s.recTarget ? targetText(s.recTarget, { trail }) : '';
      const climb = s.climbM ? ` (about ${s.climbM} m of climbing in total)` : '';
      lines.push(`${s.reps} × [${dur(s.work)} at ${w}${s.note ? ` – ${s.note}` : ''}; then ${dur(s.rec ?? {})} easy${r ? ` at ${r}` : ''}]${climb}`);
      continue;
    }
    if (s.kind === 'strides') { lines.push(`Strides: ${s.reps} × 20 s fast and relaxed, 60–90 s easy between`); continue; }
    const t = targetText(s.target, { trail });
    const climb = s.climbM ? ` – climb about ${s.climbM} m` : '';
    lines.push(`${LABEL[s.kind] ?? s.kind} ${dur(s)}${t ? ` at ${t}` : ''}${climb}${s.note ? ` – ${s.note}` : ''}`);
  }
  return lines;
}

const fmtDate = (d) => {
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return `${WEEKDAYS[(dt.getUTCDay() + 6) % 7]} ${day} ${dt.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
};

export function workoutText(workout, ctx, weekInfo = null) {
  const trail = ctx.mode === 'trail';
  const head = `${fmtDate(workout.date)}: ${workout.name} (${workout.code})${weekInfo ? `, week ${weekInfo.n}, ${weekInfo.phase}` : ''}`;
  if (workout.code === 'RACE') return `${head}\nGood luck. Race fuelling and gear as practised.`;
  const resolved = resolveTargets(workout, ctx);
  const lines = stepLines(resolved.steps, { trail }).map((l, i) => `${i + 1}. ${l}`);
  const foot = [];
  const total = `Total: ${workout.plannedMin} min`;
  if (!trail && workout.plannedKm) foot.push(`${total}, about ${workout.plannedKm} km (estimate from zone paces)`);
  else foot.push(total);
  if (trail && workout.plannedVertM) foot.push(`Climbing target: about ${workout.plannedVertM} m`);
  for (const n of workout.notes ?? []) foot.push(n);
  return [head, ...lines, ...foot].join('\n');
}

export function weekText(week, ctx) {
  const target = ctx.mode === 'trail' ? `${week.targetHours} h, ${week.targetVertM} m climbing` : `${week.targetKm} km`;
  const head = `WEEK ${week.n} (${week.start}), ${week.phase}, target ${target}`;
  return [head, ...week.workouts.map((w) => workoutText(w, ctx))].join('\n\n');
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per workout: date, week, phase, code, step list, total km and minutes. */
export function planCsv(plan, ctx) {
  const trail = ctx.mode === 'trail';
  const rows = [['date', 'weekday', 'week', 'phase', 'code', 'name', 'steps', 'total_km', 'total_min', 'climb_m']];
  for (const week of plan.weeks) {
    for (const w of week.workouts) {
      const steps = w.code === 'RACE' ? 'Race' : stepLines(resolveTargets(w, ctx).steps, { trail }).join(' | ');
      rows.push([w.date, w.weekday, week.n, week.phase, w.code, w.name, steps, trail ? '' : w.plannedKm ?? '', w.plannedMin, w.plannedVertM || '']);
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
