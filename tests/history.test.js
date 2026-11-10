import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHistory, dedupe } from '../js/core/history.js';
import { riegelTime, pace10kEquivalent, oneHourPace } from '../js/core/riegel.js';
import { addDays } from '../js/core/dates.js';

let uid = 0;
function run(date, o = {}) {
  const distanceKm = o.km ?? 8;
  return {
    date, startTime: Date.parse(date + 'T01:00:00Z') + (uid++) * 3600000 * 0 + (o.offset ?? 0), sport: 'Running',
    distanceKm, movingSec: o.sec ?? distanceKm * 360, avgPaceSecPerKm: 360, avgHr: o.hr ?? 140, gainM: o.gain ?? 0,
    climbDensity: (o.gain ?? 0) / distanceKm, terrain: 'flat', efforts: o.efforts ?? { w20: null, w30: null }, climbs: o.climbs ?? [], race: !!o.race,
  };
}
// Mon 2026-03-02 is a Monday; plan starts Mon 2026-04-27 (8 full weeks later)
const planStart = '2026-04-27';
function steadyWeeks(n, kmPerRun = 8, days = [0, 2, 4]) {
  const out = [];
  for (let w = n; w >= 1; w--) for (const d of days) out.push(run(addDays(planStart, -7 * w + d), { km: kmPerRun }));
  return out;
}

test('dedupe removes the same run from two sources', () => {
  const a = run('2026-04-01', { km: 10 });
  const b = { ...a, startTime: a.startTime + 20000, distanceKm: 10.1 };
  const c = { ...a, startTime: a.startTime + 5 * 3600000 };
  assert.equal(dedupe([a, b, c]).length, 2);
});

test('baseline is the mean of the last 4 full weeks', () => {
  const h = analyzeHistory(steadyWeeks(8), { planStart, asOf: planStart });
  assert.equal(h.windowWeeks, 8);
  assert.ok(Math.abs(h.baselineWeeklyKm - 24) < 0.01);
  assert.equal(h.runsPerWeek, 3);
  assert.equal(h.returnFromBreak, false);
});

test('current partial week is not counted', () => {
  const runs = [...steadyWeeks(8), run(addDays(planStart, 1), { km: 30 })];
  const h = analyzeHistory(runs, { planStart: addDays(planStart, 14), asOf: addDays(planStart, 2) });
  assert.ok(h.baselineWeeklyKm < 30);
});

test('12-week window only when 12 weeks of history exist', () => {
  assert.equal(analyzeHistory(steadyWeeks(12), { planStart, asOf: planStart }).windowWeeks, 12);
  assert.equal(analyzeHistory(steadyWeeks(10), { planStart, asOf: planStart }).windowWeeks, 8);
});

test('break detection reduces the baseline to 60 % of active weeks', () => {
  const runs = [];
  for (let w = 8; w >= 5; w--) for (const d of [0, 2, 4]) runs.push(run(addDays(planStart, -7 * w + d), { km: 10 }));
  // weeks 4..1 empty except week 1
  runs.push(run(addDays(planStart, -7 + 1), { km: 5 }));
  const h = analyzeHistory(runs, { planStart, asOf: planStart });
  assert.ok(h.returnFromBreak);
  assert.ok(h.baselineWeeklyKm < 20);
});

test('long gap since last run counts as a break', () => {
  const runs = steadyWeeks(8).filter((r) => r.date < addDays(planStart, -28));
  const h = analyzeHistory(runs, { planStart, asOf: planStart });
  assert.ok(h.weeksSinceLastRun >= 4);
  assert.ok(h.returnFromBreak);
});

test('self-report fallback uses 80 % when there are no files', () => {
  const h = analyzeHistory([], { planStart, asOf: planStart, selfReport: { weeklyKm: 30, runsPerWeek: 4, longestRunKm: 14 } });
  assert.equal(h.source, 'self-report');
  assert.equal(h.baselineWeeklyKm, 24);
});

test('LTHR suggestion is 95 % of the hardest 20-min avg, with confidence by repeat', () => {
  const hard = (hr) => ({ w20: { hard: { avgHr: hr, paceSecPerKm: 290, gradePct: 0 }, bestPace: null }, w30: null });
  const base = steadyWeeks(8);
  const one = analyzeHistory([...base, run(addDays(planStart, -10), { efforts: hard(170), offset: 7200000 })], { planStart, asOf: planStart });
  assert.equal(one.suggestions.lthr.value, Math.round(0.95 * 170));
  assert.equal(one.suggestions.lthr.confidence, 'medium');
  const two = analyzeHistory([...base, run(addDays(planStart, -10), { efforts: hard(170), offset: 7200000 }), run(addDays(planStart, -20), { efforts: hard(168), offset: 7200000 })], { planStart, asOf: planStart });
  assert.equal(two.suggestions.lthr.confidence, 'high');
  const none = analyzeHistory(base, { planStart, asOf: planStart });
  assert.equal(none.suggestions.lthr.value, null);
  assert.equal(none.suggestions.lthr.confidence, 'low');
});

test('threshold pace uses best 30-min flat pace', () => {
  const eff = (p) => ({ w30: { bestPace: { paceSecPerKm: p } }, w20: null });
  const h = analyzeHistory([...steadyWeeks(8), run(addDays(planStart, -9), { efforts: eff(300), offset: 7200000 }), run(addDays(planStart, -16), { efforts: eff(302), offset: 7200000 })], { planStart, asOf: planStart });
  assert.equal(h.suggestions.thresholdPaceSecPerKm.value, 300);
  assert.equal(h.suggestions.thresholdPaceSecPerKm.confidence, 'high');
});

test('Riegel helpers', () => {
  assert.ok(Math.abs(riegelTime(3000, 10, 10) - 3000) < 1e-9);
  assert.ok(riegelTime(3000, 10, 21.0975) > 3000 * 2.1);
  assert.ok(Math.abs(pace10kEquivalent(3000, 10) - 300) < 1e-9);
});

test('race to threshold pace uses the one-hour pace, not a fixed factor', () => {
  assert.ok(Math.abs(oneHourPace(3600, 10) - 360) < 1e-9);
  const p = oneHourPace(4076, 10.01); // 67:56 for 10 km
  assert.ok(p > 400 && p < 410, String(p));
  const fast = oneHourPace(2400, 10); // 40:00 10 km
  assert.ok(fast > 240 && fast < 255 * 1.05);
});

test('a runner with two weeks of history is not treated as returning from a break', () => {
  const runs = [run('2026-10-27'), run('2026-10-29'), run('2026-11-01', { km: 10 }), run('2026-11-04'), run('2026-11-08', { km: 10 })];
  const h = analyzeHistory(runs, { planStart: '2026-11-16', asOf: '2026-11-10', mode: 'trail' });
  assert.equal(h.returnFromBreak, false);
  assert.ok(Math.abs(h.baselineWeeklyKm - 22) < 0.01, `baseline ${h.baselineWeeklyKm}`); // (26 + 18) / 2
  assert.ok(h.notes.some((n) => /Only 2 full weeks/.test(n)));
  // a real gap inside the covered weeks is still a break
  const gap = analyzeHistory([run('2026-09-15'), run('2026-09-22'), run('2026-11-04')], { planStart: '2026-11-16', asOf: '2026-11-10', mode: 'trail' });
  assert.equal(gap.returnFromBreak, true);
  // runs only in the current, unfinished week
  const fresh = analyzeHistory([run('2026-11-09'), run('2026-11-10')], { planStart: '2026-11-16', asOf: '2026-11-10', mode: 'trail' });
  assert.equal(fresh.returnFromBreak, false);
  assert.ok(Math.abs(fresh.baselineWeeklyKm - 16) < 0.01);
});
