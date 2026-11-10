import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan } from '../js/core/plan/generate.js';
import { compareRun, planAdvice, regenerateFrom, runsByWorkout, suggestMatch, weekProgress, workoutStatus } from '../js/core/tracking.js';
import { addDays, nextMonday } from '../js/core/dates.js';
import { hist, settingsFor } from './helpers/plan.js';

const settings = settingsFor();
const plan = generatePlan(settings, hist(), { today: '2026-12-28' }).plan;
const week = (n) => plan.weeks[n - 1];
const mkRun = (date, o = {}) => ({ id: o.id ?? 1, date, startTime: Date.parse(date + 'T01:00:00Z'), distanceKm: o.km ?? 8, movingSec: o.sec ?? 2880, gainM: o.gain ?? 0, avgHr: 140, race: !!o.race, matchedWorkoutId: o.matched });

test('a run is matched to the planned run on the same date', () => {
  const w = week(1).workouts.find((x) => x.role === 'Q1');
  assert.equal(suggestMatch(plan, mkRun(w.date)), w.id);
});

test('a run one day off still matches, and taken workouts are skipped', () => {
  const w = week(1).workouts.find((x) => x.role === 'Q1');
  assert.equal(suggestMatch(plan, mkRun(addDays(w.date, 1)), new Set([w.id])) !== w.id, true);
  assert.equal(suggestMatch(plan, mkRun('2030-01-01')), null);
});

test('a flagged race matches the race workout', () => {
  const race = plan.weeks.at(-1).workouts.find((x) => x.code === 'RACE');
  assert.equal(suggestMatch(plan, mkRun(race.date, { race: true })), race.id);
});

test('workout status', () => {
  const w = week(2).workouts.find((x) => x.role === 'Q1');
  assert.equal(workoutStatus(w, mkRun(w.date), '2027-02-01'), 'done');
  assert.equal(workoutStatus(w, null, '2027-02-01'), 'missed');
  assert.equal(workoutStatus(w, null, w.date), 'today');
  assert.equal(workoutStatus(w, null, '2026-01-01'), 'upcoming');
  assert.equal(workoutStatus(week(1).workouts.find((x) => x.role === 'S'), null, '2027-02-01'), 'strength');
});

test('week progress compares actual with planned volume', () => {
  const w = week(1);
  const p = weekProgress(w, [mkRun(w.start, { km: w.plannedKm / 2 })], addDays(w.start, 10), 'road');
  assert.ok(Math.abs(p.ratio - 0.5) < 0.01);
  assert.equal(p.complete, true);
});

test('compare a run with its prescription', () => {
  const w = week(1).workouts.find((x) => x.role === 'L');
  const c = compareRun(w, mkRun(w.date, { km: w.plannedKm + 1, sec: (w.plannedMin + 5) * 60 }));
  assert.equal(c.minDiff, 5);
  assert.equal(c.kmDiff, 1);
});

test('runsByWorkout maps matched runs', () => {
  const m = runsByWorkout([mkRun('2027-01-05', { matched: 'w1-Tue' }), mkRun('2027-01-06')]);
  assert.equal(m.size, 1);
});

test('advice: low compliance and missed weeks', () => {
  const asOf = addDays(week(4).start, 0); // weeks 1-3 are complete
  const low = [week(1), week(2), week(3)].map((w, i) => mkRun(w.start, { id: i + 1, km: w.plannedKm * 0.3 }));
  assert.ok(planAdvice(plan, low, asOf).some((a) => a.code === 'low'));
  const fine = [week(1), week(2), week(3)].map((w, i) => mkRun(w.start, { id: i + 1, km: w.plannedKm }));
  assert.equal(planAdvice(plan, fine, asOf).length, 0);
  const missed1 = [week(1), week(2)].map((w, i) => mkRun(w.start, { id: i + 1, km: w.plannedKm }));
  const m1 = planAdvice(plan, missed1, asOf).find((a) => a.code === 'missed');
  assert.match(m1.text, /You missed last week/);
  const m2 = planAdvice(plan, [mkRun(week(1).start, { km: week(1).plannedKm })], asOf).find((a) => a.code === 'missed');
  assert.match(m2.text, /2 weeks in a row/);
  assert.ok(planAdvice(plan, [], addDays(week(5).start, 0)).some((a) => /4 weeks in a row/.test(a.text)));
});

test('regeneration keeps past weeks locked and continues the numbering', () => {
  const today = addDays(week(6).start, 2);
  const r = regenerateFrom(plan, settings, hist({ baselineWeeklyKm: 40 }), { today });
  assert.ok(r.plan, JSON.stringify(r.messages));
  const kept = r.plan.weeks.filter((w) => w.locked);
  assert.equal(kept.length, 6);
  assert.equal(JSON.stringify(kept.map((w) => w.workouts.map((x) => x.id))), JSON.stringify(plan.weeks.slice(0, 6).map((w) => w.workouts.map((x) => x.id))));
  assert.equal(r.plan.weeks[6].start, addDays(week(6).start, 7));
  assert.deepEqual(r.plan.weeks.map((w) => w.n), r.plan.weeks.map((_, i) => i + 1));
  const ids = r.plan.weeks.flatMap((w) => w.workouts.map((x) => x.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(r.plan.weeks.at(-1).workouts.at(-1).code, 'RACE');
});

test('replacing a plan unlinks every matched run, because workout ids repeat between plans', async () => {
  const { generatePlan } = await import('../js/core/plan/generate.js');
  const { settingsFor, hist } = await import('./helpers/plan.js');
  const { runsToUnlink } = await import('../js/core/tracking.js');
  const a = generatePlan(settingsFor({}), hist(), { today: '2026-12-28' }).plan;
  const b = generatePlan(settingsFor({ weeks: 20 }), hist(), { today: '2026-12-28' }).plan;
  const idsA = new Set(a.weeks.flatMap((w) => w.workouts.map((x) => x.id)));
  const idsB = new Set(b.weeks.flatMap((w) => w.workouts.map((x) => x.id)));
  // the reason the unlink is needed: the second plan reuses ids from the first
  assert.ok([...idsA].some((id) => idsB.has(id)));
  const runs = [{ id: 1, matchedWorkoutId: [...idsA][0] }, { id: 2, matchedWorkoutId: null }, { id: 3 }, { id: 4, matchedWorkoutId: [...idsA][3] }];
  assert.deepEqual(runsToUnlink(runs), [1, 4]);
  assert.deepEqual(runsToUnlink([]), []);
});

test('regenerating a plan built past the entry check keeps that choice', () => {
  const s = settingsFor({ mode: 'trail', distanceKm: 25, gain: 2300, runs: 4, weeks: 20 });
  const low = hist({ baselineWeeklyHours: 1.1, longestRunMin: 45, baselineWeeklyVertM: 30 });
  assert.equal(generatePlan(s, low, { today: '2026-12-28' }).status, 'BLOCK');
  const p = generatePlan(s, low, { today: '2026-12-28', overrideEntry: true }).plan;
  assert.equal(p.entryOverridden, true);
  const r = regenerateFrom(p, s, low, { today: addDays(START_PLAN(p), 15) });
  assert.ok(r.plan, r.messages.map((m) => m.text).join(' '));
});
const START_PLAN = (p) => p.startDate;

test('regenerating mid-plan keeps each remaining week in its phase and continues the session ladders', () => {
  const s = settingsFor({ mode: 'trail', distanceKm: 25, gain: 2300, runs: 4, weeks: 20, terrain: { Mon: 'incline', Tue: 'flat', Wed: 'incline', Thu: 'flat', Fri: 'flat', Sat: 'hills', Sun: 'hills' } });
  const h = hist({ baselineWeeklyHours: 4.5, longestRunMin: 130, baselineWeeklyVertM: 600 });
  const p = generatePlan(s, h, { today: '2026-12-28' }).plan;
  const r = regenerateFrom(p, s, h, { today: addDays(p.startDate, 7 * 9 + 2) }); // during week 10
  assert.ok(r.plan);
  assert.deepEqual(r.plan.weeks.map((w) => w.phase), p.weeks.map((w) => w.phase));
  assert.ok(!r.plan.weeks.slice(10).some((w) => w.kind === 'hold'));
  // week 11 was a Build week with a tempo; it must not fall back to a Base fartlek
  const w11 = r.plan.weeks[10].workouts.map((x) => x.code);
  assert.ok(w11.includes('TMP') && !w11.includes('FAR'), w11.join(','));
  const tempo = (pl, n) => pl.weeks[n - 1].workouts.find((x) => x.code === 'TMP')?.plannedMin ?? 0;
  assert.ok(tempo(r.plan, 11) >= tempo(p, 9), `tempo restarted: ${tempo(r.plan, 11)} after ${tempo(p, 9)}`);
});

test('advice states the volume regeneration would really start from', async () => {
  const { analyzeHistory } = await import('../js/core/history.js');
  const asOf = addDays(week(4).start, 0);
  const missed1 = [week(1), week(2)].map((w, i) => mkRun(w.start, { id: i + 1, km: w.plannedKm }));
  const a = planAdvice(plan, missed1, asOf).find((x) => x.code === 'missed');
  const h = analyzeHistory(missed1, { planStart: nextMonday(asOf), asOf, mode: 'road' });
  const lastLoad = [...plan.weeks].filter((w) => w.start <= asOf && w.kind === 'load').pop();
  assert.equal(a.restartPct, Math.round((100 * h.baselineWeeklyKm) / lastLoad.targetKm));
  assert.match(a.text, new RegExp(`about ${Math.round(h.baselineWeeklyKm)} km a week, ${a.restartPct}%`));
  // and regeneration really does start there
  const r = regenerateFrom(plan, settings, h, { today: asOf });
  const first = r.plan.weeks.find((w) => !w.locked);
  assert.ok(Math.abs(first.targetKm - h.baselineWeeklyKm) <= 1, `${first.targetKm} vs ${h.baselineWeeklyKm}`);
});

test('advice when running well above the plan for three weeks', () => {
  const asOf = addDays(week(4).start, 0);
  const high = [week(1), week(2), week(3)].map((w, i) => mkRun(w.start, { id: i + 1, km: w.plannedKm * 1.4 }));
  const a = planAdvice(plan, high, asOf);
  assert.equal(a.length, 1);
  assert.equal(a[0].code, 'high');
  assert.equal(a[0].level, 'info');
  assert.match(a[0].text, /about 140%/);
  assert.equal(a[0].action, 'regen');
  const twoWeeks = high.slice(0, 2);
  assert.ok(!planAdvice(plan, twoWeeks, addDays(week(3).start, 0)).some((x) => x.code === 'high'));
  const close = planAdvice(plan, high.map((r) => r), addDays(plan.raceDate, -20)).find((x) => x.code === 'high');
  if (close) { assert.equal(close.action, null); assert.match(close.text, /keep to the plan/); }
});
