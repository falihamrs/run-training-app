import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiReport, weeksInRange } from '../js/core/aiExport.js';
import { addDays } from '../js/core/dates.js';
import { generatePlan } from '../js/core/plan/generate.js';
import { hist, settingsFor, TERRAIN } from './helpers/plan.js';

const settings = settingsFor({ mode: 'trail', distanceKm: 25, gain: 1200, runs: 4, weeks: 16, terrain: TERRAIN });
const plan = generatePlan(settings, hist(), { today: '2026-12-28' }).plan;
const w = (n) => plan.weeks[n - 1];
const run = (date, o = {}) => ({ id: o.id ?? 1, date, distanceKm: o.km ?? 8, movingSec: o.sec ?? 3000, avgPaceSecPerKm: 375, avgHr: 148, maxHr: 165, gainM: o.gain ?? 120, climbs: [], ...o });

test('range: the last 4 finished weeks, this week and the next 4', () => {
  const today = addDays(w(6).start, 2);
  assert.deepEqual(weeksInRange(plan, today).map((x) => x.n), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(weeksInRange(plan, addDays(plan.startDate, -10)).map((x) => x.n), [1, 2, 3, 4]);
  assert.equal(weeksInRange(plan, today, 'all').length, plan.weeks.length);
  assert.deepEqual(weeksInRange(null, today), []);
});

test('the report holds the context, planned versus done, laps and unmatched runs', () => {
  const today = addDays(w(3).start, 3);
  const long = w(2).workouts.find((x) => x.role === 'L');
  const runs = [
    run(long.date, { id: 1, matchedWorkoutId: long.id, sec: (long.plannedMin + 10) * 60, gain: long.plannedVertM - 40 }),
    run(addDays(w(2).start, 1), { id: 2, indoor: true, gain: 146, manualClimb: { unit: 'pct', basis: 'laps', values: [0, 6, 1] }, laps: [{ distM: 1500, sec: 600 }, { distM: 300, sec: 120 }, { distM: 220, sec: 90 }] }),
    run(addDays(plan.startDate, -5), { id: 3, race: true }),
  ];
  const md = aiReport({ plan, runs, settings, today, advice: [{ text: 'Example advice.' }], history: hist() });
  assert.match(md, /^# Running training report/);
  assert.match(md, /trail, 25 km with 1200 m climbing/);
  assert.match(md, /LTHR \d+ bpm/);
  assert.match(md, /\| Z4 \| /);
  assert.match(md, /Phases: Base weeks 1–\d+/);
  assert.match(md, /App advice now: Example advice\./);
  assert.match(md, /\| 3 \(this week\) \|/);
  assert.match(md, new RegExp(`Versus plan: time \\+10 min, climbing -40 m`));
  assert.match(md, /Unplanned or unmatched run\*\*: 8 km, 50:00/);
  assert.match(md, /typed in by hand\), indoor\/treadmill/);
  assert.match(md, /Laps — 1: 10:00 1500 m @ 6:40, 0%; 2: 2:00 300 m @ 6:40, 6%; 3: 1:30 220 m @ 6:49, 1%/);
  assert.match(md, /no run matched/);
  assert.match(md, /## Runs before the weeks above[\s\S]*RACE/);
  assert.equal((md.match(/Squats/g) ?? []).length <= 1, true);
  assert.ok(!/undefined|NaN|null/.test(md), md.match(/.{40}(undefined|NaN|null).{20}/)?.[0]);
  // future weeks show no "done" figures
  assert.match(md, new RegExp(`\\| ${w(7).n} \\| ${w(7).start} \\| [^|]+ \\| [^|]+ \\| [^|]+ \\| – \\| – \\|`));
});

test('works without a plan and for road plans', () => {
  const md = aiReport({ plan: null, runs: [run('2026-12-20')], settings, today: '2026-12-28' });
  assert.match(md, /No plan has been generated yet/);
  assert.match(md, /## Recent runs/);
  const road = settingsFor({ distanceKm: 21.1, runs: 4, weeks: 12 });
  const rp = generatePlan(road, hist(), { today: '2026-12-28' }).plan;
  const rmd = aiReport({ plan: rp, runs: [], settings: road, today: addDays(rp.startDate, 15), range: 'all' });
  assert.match(rmd, /road, 21\.1 km/);
  assert.match(rmd, /Predicted time from the app/);
  assert.match(rmd, /about [\d.]+ km/);
  assert.ok(!/undefined|NaN/.test(rmd));
  assert.equal((rmd.match(/^### Week/gm) ?? []).length, rp.weeks.length);
});
