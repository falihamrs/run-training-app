// Milestone 5: match uploaded runs to planned workouts and measure compliance.
import { addDays, diffDays, nextMonday } from './dates.js';
import { generatePlan } from './plan/generate.js';

const isRunWorkout = (w) => w.role !== 'S';

/** Best planned workout for a run: same date first, then the day before or after. */
export function suggestMatch(plan, run, takenIds = new Set()) {
  if (!plan) return null;
  const all = plan.weeks.flatMap((w) => w.workouts);
  const near = all.filter((w) => isRunWorkout(w) && !takenIds.has(w.id) && Math.abs(diffDays(w.date, run.date)) <= 1);
  if (run.race) {
    const race = near.find((w) => w.code === 'RACE');
    if (race) return race.id;
  }
  const cands = near.filter((w) => w.code !== 'RACE');
  if (!cands.length) return null;
  const runMin = run.movingSec / 60;
  cands.sort((a, b) => Math.abs(diffDays(a.date, run.date)) - Math.abs(diffDays(b.date, run.date)) || Math.abs(a.plannedMin - runMin) - Math.abs(b.plannedMin - runMin));
  return cands[0].id;
}

export function runsByWorkout(runs) {
  const map = new Map();
  for (const r of runs) if (r.matchedWorkoutId) map.set(r.matchedWorkoutId, r);
  return map;
}

// Workout ids are only week number and weekday, so when a plan is replaced every old match has to be cleared
// or the run would attach itself to an unrelated workout in the new plan.
export function runsToUnlink(runs) {
  return runs.filter((r) => r.matchedWorkoutId).map((r) => r.id);
}

export function workoutStatus(workout, run, today) {
  if (workout.role === 'S') return 'strength';
  if (run) return 'done';
  if (workout.date < today) return 'missed';
  if (workout.date === today) return 'today';
  return 'upcoming';
}

export function weekProgress(week, runs, today, mode) {
  const end = addDays(week.start, 6);
  const inWeek = runs.filter((r) => r.date >= week.start && r.date <= end);
  const actualKm = inWeek.reduce((s, r) => s + r.distanceKm, 0);
  const actualMin = inWeek.reduce((s, r) => s + r.movingSec / 60, 0);
  const actualVertM = inWeek.reduce((s, r) => s + r.gainM, 0);
  // the week totals leave the race out, so add it back when comparing with what was actually run
  const race = week.workouts?.find((w) => w.role === 'RACE');
  const planned = (mode === 'trail' ? week.plannedMin : week.plannedKm) + (race ? (mode === 'trail' ? race.plannedMin : race.plannedKm) : 0);
  const actual = mode === 'trail' ? actualMin : actualKm;
  return {
    actualKm, actualMin, actualVertM, runs: inWeek.length,
    plannedKm: week.plannedKm, plannedMin: week.plannedMin, plannedVertM: week.plannedVertM,
    ratio: planned > 0 ? actual / planned : null,
    complete: end < today,
  };
}

/** Compare a matched run with its prescription. */
export function compareRun(workout, run) {
  return {
    minDiff: Math.round(run.movingSec / 60 - workout.plannedMin),
    kmDiff: workout.plannedKm != null ? Math.round((run.distanceKm - workout.plannedKm) * 10) / 10 : null,
    vertDiff: workout.plannedVertM ? Math.round(run.gainM - workout.plannedVertM) : null,
    avgHr: run.avgHr ? Math.round(run.avgHr) : null,
  };
}

/** Advice from completed weeks: low compliance and missed weeks (spec section 10). */
export function planAdvice(plan, runs, today) {
  const out = [];
  if (!plan) return out;
  const done = plan.weeks.filter((w) => addDays(w.start, 6) < today && w.kind !== 'taper' && !w.locked);
  const prog = done.map((w) => ({ w, p: weekProgress(w, runs, today, plan.mode) }));
  let missed = 0;
  for (let i = prog.length - 1; i >= 0; i--) { if (prog[i].p.runs === 0) missed++; else break; }
  if (missed >= 3) out.push({ code: 'missed', level: 'warn', text: `You have missed ${missed} weeks in a row. Regenerate the plan from next Monday so it starts from what you really run now.`, action: 'regen' });
  else if (missed === 2) out.push({ code: 'missed', level: 'warn', text: 'You missed 2 weeks. Regenerate from next Monday; the plan will resume at about 70% of your last loading week.', action: 'regen' });
  else if (missed === 1) out.push({ code: 'missed', level: 'warn', text: 'You missed last week. Regenerate from next Monday to resume at about 85% of your last loading week.', action: 'regen' });
  const last2 = prog.slice(-2);
  if (!missed && last2.length === 2 && last2.every((x) => x.p.ratio != null && x.p.ratio < 0.7)) {
    out.push({ code: 'low', level: 'warn', text: 'You completed under 70% of the planned volume for two weeks in a row. Consider regenerating from next Monday with your current baseline.', action: 'regen' });
  }
  return out;
}

/**
 * Regenerate from the next Monday. Past weeks stay locked; the new weeks continue the numbering.
 * @returns {{status, messages, plan}} same shape as generatePlan
 */
export function regenerateFrom(oldPlan, settings, history, { today, now = null } = {}) {
  const newStart = nextMonday(today);
  const keep = oldPlan.weeks.filter((w) => w.start < newStart).map((w) => ({ ...w, locked: true }));
  const s = { ...settings, schedule: { ...settings.schedule, startDate: newStart } };
  // a plan that is already under way is never refused for a low baseline; it gets a warning instead
  // carry the periodisation over: each remaining week keeps its phase, and the session ladders continue
  const future = oldPlan.weeks.filter((w) => w.start >= newStart);
  const phaseIdx = { base: 0, build: 0, peak: 0, taper: 0 };
  const ptr = {};
  for (const w of keep) {
    phaseIdx[w.phase] = (phaseIdx[w.phase] ?? 0) + 1;
    for (const x of w.workouts) if (['THR', 'VO2', 'CLB', 'HIL', 'DWN', 'FAR', 'TMP', 'HIKE', 'MP'].includes(x.code)) ptr[x.code] = Math.min(8, (ptr[x.code] ?? 0) + 1);
  }
  const resume = future.length ? { phases: future.map((w) => w.phase), phaseIdx, ptr } : null;
  const r = generatePlan(s, history, { today, id: oldPlan.id, now, allowShort: true, overrideEntry: true, resume });
  if (!r.plan) return r;
  const offset = keep.length;
  const weeks = r.plan.weeks.map((w) => {
    const n = w.n + offset;
    const workouts = w.workouts.map((x) => ({ ...x, week: n, id: x.id === 'race' ? 'race' : x.id.replace(/^w\d+/, `w${n}`) }));
    return { ...w, n, workouts };
  });
  return { ...r, plan: { ...r.plan, startDate: keep.length ? oldPlan.startDate : r.plan.startDate, weeks: [...keep, ...weeks], regeneratedAt: now } };
}
