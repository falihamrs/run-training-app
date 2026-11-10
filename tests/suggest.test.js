import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../js/core/dates.js';
import { canInsertTest, climbTrend, goalAdvice, insertTest, nextWorkoutDate, suggestThresholdUpdate, testResultFromRun } from '../js/core/suggest.js';
import { generatePlan } from '../js/core/plan/generate.js';
import { resolveTargets } from '../js/core/targets.js';
import { emptyCorosZones } from '../js/core/zones.js';
import { hist, settingsFor } from './helpers/plan.js';

const TODAY = '2027-03-01';
const ths = (lthr = 168, pace = 330) => [{ effectiveFrom: '2027-01-04', lthr, paceSecPerKm: pace, source: 'manual' }];
let id = 0;
const hard = (daysAgo, { hr = 180, pace = 322, race = false } = {}) => ({
  id: ++id, date: addDays(TODAY, -daysAgo), distanceKm: 10, movingSec: 3500, climbDensity: 2, gainM: 20, race, avgHr: 150, climbs: [],
  efforts: { w20: { hard: { avgHr: hr, paceSecPerKm: pace, gradePct: 0 }, bestPace: null }, w30: { bestPace: { paceSecPerKm: pace } } },
});
const sug = (runs, o = {}) => suggestThresholdUpdate({ runs, thresholds: ths(), today: TODAY, raceDate: '2027-06-01', easyPaceSecPerKm: 400, ...o });

test('two faster hard efforts in 4 weeks suggest an update', () => {
  const r = sug([hard(3), hard(12)]);
  assert.equal(r.kind, 'update');
  assert.equal(r.pace.proposed, 322);
  assert.equal(r.lthr.proposed, Math.round(0.95 * 180));
});

test('a single effort is not enough, but a race is', () => {
  assert.equal(sug([hard(3)]).kind, 'none');
  assert.equal(sug([hard(3, { race: true })]).kind, 'update');
});

test('efforts older than 4 weeks do not count', () => {
  assert.equal(sug([hard(30), hard(35)]).kind, 'none');
});

test('a gap above the caps asks for a test instead', () => {
  assert.equal(sug([hard(3, { pace: 305, hr: 190 }), hard(8, { pace: 306, hr: 190 })]).kind, 'test-needed');
});

test('slower estimates only suggest a retest', () => {
  const r = sug([hard(3, { pace: 345, hr: 165 }), hard(10, { pace: 346, hr: 165 })]);
  assert.equal(r.kind, 'retest');
  assert.equal(r.pace.proposed ?? null, null);
});

test('no suggestion within 10 days of the race or 21 days of the last one', () => {
  const runs = [hard(3), hard(12)];
  assert.equal(sug(runs, { raceDate: addDays(TODAY, 9) }).reason, 'race-close');
  assert.equal(sug(runs, { state: { resolvedOn: addDays(TODAY, -10) } }).reason, 'cooldown');
  assert.equal(sug(runs, { state: { resolvedOn: addDays(TODAY, -22) } }).kind, 'update');
});

test('changes under the 2% / 3 bpm triggers are ignored', () => {
  assert.equal(sug([hard(3, { pace: 328, hr: 177 }), hard(9, { pace: 328, hr: 177 })]).kind, 'none');
});

test('climb trend needs two climbs and a 5% rise', () => {
  const climbs = (mh) => [{ avgHr: 168, climbSpeedMh: mh }, { avgHr: 170, climbSpeedMh: mh }];
  const runs = [{ date: addDays(TODAY, -5), climbs: climbs(630) }, { date: addDays(TODAY, -40), climbs: climbs(580) }];
  const t = climbTrend(runs, 168, TODAY);
  assert.equal(t.significant, true);
  assert.equal(climbTrend([{ date: addDays(TODAY, -5), climbs: [{ avgHr: 168, climbSpeedMh: 630 }] }, runs[1]], 168, TODAY), null);
});

test('goal advice appears only when the prediction is 3% or more faster', () => {
  assert.equal(goalAdvice({ goalTimeSec: 15100, thresholdPaceSecPerKm: 330, distanceKm: 42.195 }), null);
  assert.ok(goalAdvice({ goalTimeSec: 16000, thresholdPaceSecPerKm: 330, distanceKm: 42.195 }));
});

test('the optional test replaces a Build or Peak Q1, once per 8 weeks', () => {
  const plan = generatePlan(settingsFor(), hist(), { today: '2026-12-28' }).plan;
  const w = plan.weeks[8].workouts.find((x) => x.role === 'Q1');
  assert.equal(canInsertTest(plan, w, '2027-01-04'), true);
  assert.equal(canInsertTest(plan, plan.weeks[0].workouts.find((x) => x.role === 'Q1'), '2027-01-04'), false);
  const p2 = insertTest(plan, w.id);
  const t = p2.weeks[8].workouts.find((x) => x.id === w.id);
  assert.equal(t.code, 'TEST');
  assert.equal(t.steps[1].durationMin, 30);
  assert.equal(canInsertTest(p2, p2.weeks[9].workouts.find((x) => x.role === 'Q1'), '2027-01-04'), false);
  const r = resolveTargets(t, { thresholds: settingsFor().thresholds, coros: emptyCorosZones(), mode: 'road', goalPaceSecPerKm: 340 });
  assert.equal(r.steps.length, 3);
  assert.equal(nextWorkoutDate(plan, '2027-01-05'), '2027-01-05');
});

test('test result from a run', () => {
  assert.deepEqual(testResultFromRun(hard(1, { hr: 171.4, pace: 301.6 })), { paceSecPerKm: 302, lthr: 171 });
});

test('inserting a test keeps the week totals in step, and shrinking a session shortens the repetitions last', async () => {
  const W = await import('../js/core/plan/workouts.js');
  const p = generatePlan(settingsFor({ distanceKm: 21.1, runs: 5, weeks: 16 }), hist(), { today: '2026-12-28' }).plan;
  const target = p.weeks.flatMap((w) => w.workouts).find((w) => canInsertTest(p, w, '2026-12-28'));
  const p2 = insertTest(p, target.id);
  const wk = p2.weeks.find((w) => w.n === target.week);
  assert.equal(wk.plannedMin, wk.workouts.filter((x) => x.role !== 'S' && x.role !== 'RACE').reduce((a, x) => a + x.plannedMin, 0));
  const rp = W.racePaceSteps('half', 300);
  const small = W.fitSteps(rp, 30);
  assert.ok(W.totalMinutes(small) < W.totalMinutes(W.fitSteps(rp, 60)));
  const rep = small.find((s) => s.kind === 'repeat');
  assert.ok(rep.work.durationMin >= 7.5 && rep.work.durationMin < 15);
  assert.equal(rep.work.note, undefined);
  assert.equal(rp.find((s) => s.kind === 'repeat').work.durationMin, 15); // the original is untouched
});
