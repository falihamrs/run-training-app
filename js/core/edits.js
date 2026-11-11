// Edits to single workouts and weeks of a plan, made by hand or from an AI's change block.
// Every edit goes through the same checks. A manual edit that breaks a training rule is allowed with a
// warning (it is your plan); the same edit from an AI is refused. Past workouts, the race and runs already
// matched to a workout are never changed.
import { WEEKDAYS, addDays, diffDays, nextMonday } from './dates.js';
import * as W from './plan/workouts.js';

export const MIN_RUN_MIN = 15;
export const MAX_RUN_MIN = 360;
const HARD = new Set(['Q1', 'Q2', 'L', 'M', 'RACE']);
const EASY_ROLES = new Set(['E', 'R', 'L', 'M']);
const UNDO_DEPTH = 10;

const clone = (x) => JSON.parse(JSON.stringify(x));
const round5 = (x) => Math.max(5, Math.round(x / 5) * 5);
const isRun = (w) => w.role !== 'S';

function find(plan, id) {
  for (const week of plan.weeks) {
    const w = week.workouts.find((x) => x.id === id);
    if (w) return { week, w };
  }
  return null;
}

/** Seconds per km for easy running in this plan (stored on new plans, worked out from old ones). */
function easyPaceOf(plan) {
  if (plan.easyPaceSecPerKm) return plan.easyPaceSecPerKm;
  const easy = plan.weeks.flatMap((w) => w.workouts).filter((w) => (w.code === 'EZ' || w.code === 'LR') && w.plannedKm > 0);
  if (!easy.length) return 390;
  const min = easy.reduce((s, w) => s + w.plannedMin, 0);
  const km = easy.reduce((s, w) => s + w.plannedKm, 0);
  return Math.round((min * 60) / km);
}

export function retotal(plan, week) {
  const runs = week.workouts.filter((w) => w.role !== 'S' && w.role !== 'RACE');
  week.plannedMin = runs.reduce((s, w) => s + w.plannedMin, 0);
  week.plannedVertM = runs.reduce((s, w) => s + (w.plannedVertM ?? 0), 0);
  if (plan.mode !== 'trail') week.plannedKm = Math.round(runs.reduce((s, w) => s + (w.plannedKm ?? 0), 0) * 10) / 10;
}

function sortWeek(week) {
  week.workouts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.role === 'S' ? 1 : b.role === 'S' ? -1 : 0));
}

/** Why a workout cannot be changed at all, or null. */
export function lockReason(plan, id, { today, source = 'manual', runs = [] }) {
  const f = find(plan, id);
  if (!f) return `There is no workout "${id}" in this plan.`;
  const { week, w } = f;
  if (w.role === 'RACE') return 'The race cannot be changed here. Change the race in Settings.';
  if (week.locked) return 'This week is locked because it was already trained when the plan was regenerated.';
  if (w.date < today) return 'This workout is in the past.';
  if (source === 'ai' && w.date < nextMonday(today)) return 'Changes from an AI start next Monday, so the current week stays as it is.';
  if (runs.some((r) => r.matchedWorkoutId === id)) return 'A run is already matched to this workout.';
  return null;
}

// set the main part of an easy-type workout so the whole workout lasts `min`
function resizeEasy(w, min) {
  const steps = clone(w.steps);
  const others = (s) => s.kind !== 'easy' && s.kind !== 'steady';
  const main = steps.filter((s) => s.kind === 'easy' || s.kind === 'steady').sort((a, b) => b.durationMin - a.durationMin)[0];
  if (!main) return W.easySteps(min, { zone: 'Z2' });
  const rest = W.totalMinutes(steps) - main.durationMin;
  main.durationMin = Math.max(10, min - rest);
  if (W.totalMinutes(steps) > min && steps.some(others)) {
    // the strides or blocks around it do not fit: keep just the easy running
    return [{ ...main, durationMin: min }];
  }
  return steps;
}

function setClimb(w, newMin) {
  if (!w.plannedVertM) return;
  const cap = Math.floor((400 * newMin) / 60 / 10) * 10;
  const v = Math.min(cap, Math.round((w.plannedVertM * newMin) / w.plannedMin / 10) * 10);
  const total = w.steps.reduce((s, x) => s + (x.climbM ?? 0), 0);
  if (total > 0) for (const s of w.steps) if (s.climbM) s.climbM = Math.round((s.climbM * v) / total);
  // keep the step total equal to the workout total after rounding
  const diff = v - w.steps.reduce((s, x) => s + (x.climbM ?? 0), 0);
  const first = w.steps.find((s) => s.climbM);
  if (first) first.climbM += diff;
  w.plannedVertM = v;
}

function setMinutes(plan, w, steps) {
  const old = w.plannedMin;
  const min = W.totalMinutes(steps);
  w.steps = steps;
  setClimb(w, min);
  if (plan.mode !== 'trail' && w.plannedKm != null && old > 0) w.plannedKm = Math.round(((w.plannedKm * min) / old) * 10) / 10;
  w.plannedMin = min;
}

// training-rule checks on the plan after an edit; returns messages
function ruleProblems(plan, week, w, before, { moved = false, oldMin = null } = {}) {
  const out = [];
  const snap = plan.settingsSnapshot ?? {};
  if (moved && w.role !== 'S' && (snap.unavailableDays ?? []).includes(w.weekday)) out.push(`${w.weekday} is one of your unavailable days.`);
  if (moved && HARD.has(w.role)) {
    // the long run and the medium run of a back-to-back weekend belong together
    const pair = (a, b) => (a === 'L' && b === 'M') || (a === 'M' && b === 'L');
    const near = plan.weeks.flatMap((x) => x.workouts).find((x) => x !== w && HARD.has(x.role) && Math.abs(diffDays(x.date, w.date)) <= 1 && !pair(x.role, w.role));
    if (near) out.push(`A hard session would be ${near.date === w.date ? 'on the same day as' : 'next to'} ${near.name} on ${near.weekday} ${near.date}.`);
  }
  const trail = plan.mode === 'trail';
  const target = trail ? week.targetHours * 60 : week.targetKm;
  const now = trail ? week.plannedMin : week.plannedKm;
  const was = trail ? before.plannedMin : before.plannedKm;
  if (target > 0 && now > was && now > 1.1 * Math.max(target, was)) {
    out.push(`Week ${week.n} would be ${Math.round((100 * now) / target)}% of its target ${trail ? 'time' : 'distance'}, more than the 10% the plan allows.`);
  }
  if (w && w.role === 'L' && oldMin != null && w.plannedMin > oldMin) {
    const prevLong = Math.max(0, ...plan.weeks.filter((x) => x.n < week.n).flatMap((x) => x.workouts).filter((x) => x.role === 'L').map((x) => x.plannedMin));
    if (prevLong > 0 && w.plannedMin > Math.max(prevLong * 1.1, prevLong + 15)) out.push(`The long run would grow from ${prevLong} to ${w.plannedMin} minutes, faster than the plan allows.`);
  }
  if (w && w.plannedVertM && w.plannedVertM > (400 * w.plannedMin) / 60 + 0.5) out.push('More than 400 m of climbing per hour.');
  if (moved && w && w.role !== 'S' && w.plannedVertM > 0 && plan.mode === 'trail' && !['hills', 'incline'].includes(w.terrain)) {
    out.push(`${w.name} has ${w.plannedVertM} m of climbing planned, but ${w.weekday} is a flat day.`);
  }
  return out;
}

/**
 * Applies one change to a copy of the plan. A change is one of:
 *   { op: 'move', workout, to: 'Mon'..'Sun' }      within the same week
 *   { op: 'swap', workout, with }                 two workouts of one week trade days
 *   { op: 'duration', workout, minutes }
 *   { op: 'easy', workout, minutes? }             becomes an easy run (default: same length, at most 45 min)
 *   { op: 'rest', workout }                       removed: a rest day
 *   { op: 'scaleWeek', week, factor }             every changeable workout in the week, 0.5 to 1.1
 * @returns {{ ok:boolean, plan?:object, error?:string, warnings:string[], summary?:string }}
 */
export function applyChange(planIn, change, { today, source = 'manual', runs = [], at = null } = {}) {
  const plan = clone(planIn);
  const fail = (error) => ({ ok: false, error, warnings: [] });
  const op = change?.op;
  if (op === 'scaleWeek') return scaleWeek(plan, change, { today, source, runs, at });
  if (op === 'swap') return swapWorkouts(plan, change, { today, source, runs, at });
  if (!['move', 'duration', 'easy', 'rest'].includes(op)) return fail(`Unknown change "${op}".`);
  const lock = lockReason(plan, change.workout, { today, source, runs });
  if (lock) return fail(lock);
  const { week, w } = find(plan, change.workout);
  const before = { plannedMin: week.plannedMin, plannedKm: week.plannedKm };
  const label = `${w.weekday} ${w.date} ${w.name}`;
  const oldMin = w.plannedMin;
  let summary;

  if (op === 'move') {
    const to = String(change.to ?? '').slice(0, 3);
    const day = WEEKDAYS.find((d) => d.toLowerCase() === to.toLowerCase());
    if (!day) return fail('Give a weekday to move to, Mon to Sun.');
    const date = addDays(week.start, WEEKDAYS.indexOf(day));
    if (date === w.date) return fail('The workout is already on that day.');
    if (date > plan.raceDate || (w.role !== 'S' && date === plan.raceDate)) return fail('That day is not before the race.');
    if (date < today || (source === 'ai' && date < nextMonday(today))) return fail('That day is in the past.');
    const taken = week.workouts.find((x) => x.date === date && x !== w && (isRun(x) === isRun(w)));
    if (taken) return fail(`${day} already has ${taken.name}. Move that one first, or make one of them a rest day.`);
    const id = `w${week.n}-${day}${isRun(w) ? (w.code === 'SHK' ? '-SHK' : '') : '-S'}`;
    if (plan.weeks.some((x) => x.workouts.some((y) => y.id === id && y !== w))) return fail('That day already has a workout with the same id.');
    summary = `${label} moved to ${day} ${date}`;
    Object.assign(w, { date, weekday: day, id, terrain: isRun(w) ? plan.settingsSnapshot?.dayTerrain?.[day] ?? w.terrain : w.terrain });
    sortWeek(week);
  } else if (op === 'rest') {
    week.workouts = week.workouts.filter((x) => x !== w);
    summary = `${label} removed (rest day)`;
  } else if (op === 'duration') {
    if (!isRun(w)) return fail('The strength session has a fixed length.');
    const min = Math.round(Number(change.minutes));
    if (!Number.isFinite(min) || min < MIN_RUN_MIN || min > MAX_RUN_MIN) return fail(`Give a length between ${MIN_RUN_MIN} and ${MAX_RUN_MIN} minutes.`);
    if (min === w.plannedMin) return fail('The workout already has that length.');
    if (EASY_ROLES.has(w.role) || w.code === 'EZ' || w.code === 'SHK') setMinutes(plan, w, resizeEasy(w, min));
    else if (min < w.plannedMin) {
      const steps = W.fitSteps(w.steps, min);
      if (W.totalMinutes(steps) > min + 2) return fail(`This session cannot be shorter than about ${W.totalMinutes(steps)} minutes. Make it an easy run instead.`);
      setMinutes(plan, w, steps);
    } else return fail('Quality sessions can be made shorter, not longer. Add an easy run instead.');
    summary = `${label}: ${oldMin} → ${w.plannedMin} min`;
  } else if (op === 'easy') {
    if (!isRun(w)) return fail('Only runs can become an easy run.');
    const min = change.minutes == null ? Math.min(w.plannedMin, 45) : Math.round(Number(change.minutes));
    if (!Number.isFinite(min) || min < MIN_RUN_MIN || min > MAX_RUN_MIN) return fail(`Give a length between ${MIN_RUN_MIN} and ${MAX_RUN_MIN} minutes.`);
    const climbs = plan.mode === 'trail' && (w.terrain === 'hills' || w.terrain === 'incline') && w.plannedVertM > 0;
    const vert = climbs ? Math.min(Math.round((w.plannedVertM * min) / w.plannedMin / 10) * 10, Math.floor((400 * min) / 60 / 10) * 10) : 0;
    const steps = W.easySteps(min, { zone: 'Z2', flat: !climbs, climbM: vert || 0 });
    const km = plan.mode === 'trail' ? null : Math.round(((min * 60) / easyPaceOf(plan)) * 10) / 10;
    summary = `${label} → easy run ${min} min`;
    Object.assign(w, { code: 'EZ', name: W.NAMES.EZ, role: 'E', steps, plannedMin: W.totalMinutes(steps), plannedVertM: vert, plannedKm: km, notes: [] });
  }
  if (w && op !== 'rest') w.edited = true;
  retotal(plan, week);
  const problems = ruleProblems(plan, week, op === 'rest' ? null : w, before, { moved: op === 'move', oldMin });
  if (problems.length && source === 'ai') return fail(problems.join(' '));
  log(plan, { source, change, summary, at, warnings: problems });
  return { ok: true, plan, warnings: problems, summary };
}

// Two workouts of one week trade days. A run swaps with a run and a strength session with a strength
// session; a workout going to an empty day is a move. Same locks, warnings and undo as any other edit.
function swapWorkouts(plan, change, { today, source, runs, at }) {
  const fail = (error) => ({ ok: false, error, warnings: [] });
  const idA = String(change.workout ?? '');
  const idB = String(change.with ?? '');
  if (!idB) return fail('Give the other workout to swap with.');
  if (idA === idB) return fail('Choose two different workouts to swap.');
  for (const id of [idA, idB]) {
    const lock = lockReason(plan, id, { today, source, runs });
    if (lock) return fail(lock);
  }
  const fa = find(plan, idA);
  const fb = find(plan, idB);
  if (fa.week !== fb.week) return fail('Swapping works within one week. Move a workout to a day in its own week instead.');
  const { week, w: a } = fa;
  const b = fb.w;
  if (isRun(a) !== isRun(b)) return fail('Swap a run with a run, or a strength session with a strength session.');
  if (a.date === b.date) return fail('Both workouts are already on the same day.');
  const idFor = (w, day) => `w${week.n}-${day}${isRun(w) ? (w.code === 'SHK' ? '-SHK' : '') : '-S'}`;
  const newA = idFor(a, b.weekday);
  const newB = idFor(b, a.weekday);
  if (plan.weeks.some((x) => x.workouts.some((y) => y !== a && y !== b && (y.id === newA || y.id === newB)))) return fail('One of those days already has a workout with the same id.');
  const before = { plannedMin: week.plannedMin, plannedKm: week.plannedKm };
  const labelA = `${a.weekday} ${a.name}`;
  const labelB = `${b.weekday} ${b.name}`;
  const dayTerrain = plan.settingsSnapshot?.dayTerrain ?? {};
  const [da, dateA, dateB] = [a.weekday, a.date, b.date];
  Object.assign(a, { date: dateB, weekday: b.weekday, id: newA, terrain: isRun(a) ? dayTerrain[b.weekday] ?? a.terrain : a.terrain, edited: true });
  Object.assign(b, { date: dateA, weekday: da, id: newB, terrain: isRun(b) ? dayTerrain[da] ?? b.terrain : b.terrain, edited: true });
  sortWeek(week);
  retotal(plan, week);
  const problems = [...new Set([a, b].flatMap((w) => ruleProblems(plan, week, w, before, { moved: true })))];
  const summary = `${labelA} swapped with ${labelB}`;
  if (problems.length && source === 'ai') return fail(problems.join(' '));
  log(plan, { source, change, summary, at, warnings: problems });
  return { ok: true, plan, warnings: problems, summary };
}

function scaleWeek(plan, change, { today, source, runs, at }) {
  const fail = (error) => ({ ok: false, error, warnings: [] });
  const week = plan.weeks.find((x) => x.n === Number(change.week));
  if (!week) return fail(`There is no week ${change.week} in this plan.`);
  const factor = Number(change.factor);
  const [lo, hi] = source === 'ai' ? [0.7, 1.1] : [0.5, 1.1];
  if (!Number.isFinite(factor) || factor < lo || factor > hi || factor === 1) return fail(`Give a factor between ${lo} and ${hi}, for example 0.9 for 10% less.`);
  const before = { plannedMin: week.plannedMin, plannedKm: week.plannedKm };
  let changed = 0;
  for (const w of week.workouts) {
    if (!isRun(w) || lockReason(plan, w.id, { today, source, runs })) continue;
    const min = Math.max(MIN_RUN_MIN, round5(w.plannedMin * factor));
    if (min === w.plannedMin) continue;
    if (EASY_ROLES.has(w.role) || w.code === 'EZ' || w.code === 'SHK') setMinutes(plan, w, resizeEasy(w, min));
    else if (factor < 1) setMinutes(plan, w, W.fitSteps(w.steps, min));
    else continue; // quality sessions do not grow
    w.edited = true;
    changed++;
  }
  if (!changed) return fail(`Nothing in week ${week.n} can be changed (past, matched or already at the shortest length).`);
  retotal(plan, week);
  const summary = `Week ${week.n}: ${factor < 1 ? `${Math.round((1 - factor) * 100)}% less` : `${Math.round((factor - 1) * 100)}% more`} (${changed} workout${changed === 1 ? '' : 's'})`;
  const problems = ruleProblems(plan, week, null, before);
  if (problems.length && source === 'ai') return fail(problems.join(' '));
  log(plan, { source, change, summary, at, warnings: problems });
  return { ok: true, plan, warnings: problems, summary };
}

function log(plan, { source, change, summary, at, warnings }) {
  plan.edits = [...(plan.edits ?? []), { at: at ?? new Date().toISOString(), source, change: clone(change), summary, reason: change.reason ?? null, warnings }];
}

/**
 * Applies several changes in order as one step that can be undone together. Changes that fail are
 * skipped and reported; the others still apply.
 */
export function applyChanges(planIn, changes, opts = {}) {
  let plan = planIn;
  const results = [];
  for (const c of changes) {
    const r = applyChange(plan, c, opts);
    results.push({ change: c, ...r, plan: undefined });
    if (r.ok) plan = r.plan;
  }
  if (plan !== planIn) {
    const undo = [...(planIn.undo ?? []), { label: opts.label ?? results.filter((r) => r.ok).map((r) => r.summary).join('; '), weeks: planIn.weeks, edits: planIn.edits ?? [] }].slice(-UNDO_DEPTH);
    plan = { ...plan, undo };
  }
  return { plan, results };
}

export function canUndo(plan) {
  return Boolean(plan?.undo?.length);
}

export function undoLast(plan) {
  if (!canUndo(plan)) return plan;
  const last = plan.undo[plan.undo.length - 1];
  return { ...plan, weeks: last.weeks, edits: last.edits, undo: plan.undo.slice(0, -1) };
}

/** Edits made to weeks that a regeneration from `from` would rebuild. */
export function editsLostByRegen(plan, from) {
  const rebuilt = new Set(plan.weeks.filter((w) => w.start >= from).map((w) => w.n));
  return plan.weeks.filter((w) => rebuilt.has(w.n)).flatMap((w) => w.workouts).filter((w) => w.edited).length
    + (plan.edits ?? []).filter((e) => e.change?.op === 'rest' && rebuilt.has(Number(String(e.change.workout).match(/^w(\d+)-/)?.[1]))).length;
}
