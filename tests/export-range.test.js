import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiReport } from '../js/core/aiExport.js';
import { actualCsv, resolveRange } from '../js/core/exportRange.js';
import { planCsv } from '../js/core/export.js';
import { clipWeeks, inRange } from '../js/core/rangeUtil.js';
import { addDays } from '../js/core/dates.js';
import { generatePlan } from '../js/core/plan/generate.js';
import { hist, settingsFor, TERRAIN } from './helpers/plan.js';

const settings = settingsFor({ mode: 'trail', distanceKm: 25, gain: 1200, runs: 4, weeks: 16, terrain: TERRAIN });
const plan = generatePlan(settings, hist(), { today: '2026-12-28' }).plan;
const ctx = { thresholds: settings.thresholds, coros: settings.corosZones, mode: 'trail', goalPaceSecPerKm: null };
const w = (n) => plan.weeks[n - 1];
const run = (date, o = {}) => ({ id: o.id ?? 1, date, distanceKm: 8, movingSec: 3000, avgPaceSecPerKm: 375, avgHr: 148, maxHr: 165, gainM: 120, ...o });
const lines = (csv) => csv.trim().split('\n');

test('resolveRange: presets and custom dates', () => {
  const today = addDays(w(6).start, 2);
  assert.equal(resolveRange(plan, today, 'all'), null);
  assert.deepEqual(resolveRange(plan, today, 'recent'), { from: w(2).start, to: addDays(w(10).start, 6) });
  assert.deepEqual(resolveRange(plan, today, 'custom', { from: '2027-01-10', to: '2027-01-20' }), { from: '2027-01-10', to: '2027-01-20' });
  assert.deepEqual(resolveRange(plan, today, 'custom', { from: '2027-02-01', to: '2027-01-01' }), { from: '2027-01-01', to: '2027-02-01' }, 'reversed dates are swapped');
  assert.deepEqual(resolveRange(plan, today, 'custom', { from: '2027-02-01', to: '' }), { from: '2027-02-01', to: null });
  assert.equal(resolveRange(plan, today, 'custom', {}), null);
});

test('clipWeeks keeps overlapping weeks and only the workouts inside the range', () => {
  const r = { from: w(3).start, to: addDays(w(3).start, 2) };
  const ws = clipWeeks(plan.weeks, r);
  assert.deepEqual(ws.map((x) => x.n), [3]);
  assert.ok(ws[0].workouts.every((x) => inRange(x.date, r)));
  assert.equal(clipWeeks(plan.weeks, null), plan.weeks);
});

test('plan CSV honours the range', () => {
  const all = lines(planCsv(plan, ctx));
  const r = { from: w(2).start, to: addDays(w(3).start, 6) };
  const part = lines(planCsv(plan, ctx, r));
  assert.ok(part.length > 1 && part.length < all.length);
  for (const l of part.slice(1)) assert.ok(inRange(l.split(',')[0], r), l);
});

test('planned-vs-actual CSV: matched run, missed workout, unplanned run, range', () => {
  const long = w(2).workouts.find((x) => x.role === 'L');
  const easy = w(2).workouts.find((x) => x.role === 'E');
  const today = addDays(w(3).start, 1);
  const runs = [
    run(long.date, { id: 1, matchedWorkoutId: long.id, movingSec: (long.plannedMin + 10) * 60, gainM: long.plannedVertM - 40 }),
    run(addDays(w(1).start, 1), { id: 2 }),
  ];
  const rows = lines(actualCsv(plan, runs, { today, mode: 'trail', range: { from: w(2).start, to: addDays(w(2).start, 6) } }));
  const head = rows[0].split(',');
  const col = (line, name) => line.split(',')[head.indexOf(name)];
  const longRow = rows.find((l) => l.startsWith(long.date));
  assert.equal(col(longRow, 'status'), 'done');
  assert.equal(col(longRow, 'diff_min'), '10');
  assert.equal(col(longRow, 'diff_climb_m'), '-40');
  const easyRow = rows.find((l) => l.startsWith(easy.date) && l.includes(easy.code));
  assert.equal(col(easyRow, 'status'), 'missed');
  assert.equal(col(easyRow, 'actual_km'), '');
  assert.ok(!rows.some((l) => l.includes('Unplanned')), 'the unmatched run of week 1 is outside the range');
  const whole = lines(actualCsv(plan, runs, { today, mode: 'trail' }));
  assert.ok(whole.some((l) => l.includes('Unplanned or unmatched run') && l.includes('unplanned')));
  assert.equal(whole.length, 1 + plan.weeks.reduce((n, x) => n + x.workouts.length, 0) + 1);
  const dates = whole.slice(1).map((l) => l.split(',')[0]);
  assert.deepEqual(dates, [...dates].sort());
});

test('AI report with custom dates covers only those days', () => {
  const today = addDays(w(4).start, 2);
  const r = { from: w(2).start, to: addDays(w(3).start, 6) };
  const md = aiReport({ plan, runs: [run(addDays(w(1).start, 1), { id: 5 })], settings, today, range: r, history: hist() });
  assert.match(md, new RegExp(`Only ${r.from} to ${r.to}`));
  assert.match(md, /### Week 2 /);
  assert.match(md, /### Week 3 /);
  assert.doesNotMatch(md, /### Week 1 /);
  assert.doesNotMatch(md, /### Week 4 /);
  assert.doesNotMatch(md, /Unplanned or unmatched run/);
});
