import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan } from '../js/core/plan/generate.js';
import { planCsv, weekText, workoutText } from '../js/core/export.js';
import { emptyCorosZones } from '../js/core/zones.js';
import { TERRAIN, hist, settingsFor } from './helpers/plan.js';

const road = generatePlan(settingsFor(), hist(), { today: '2026-12-28' }).plan;
const trailS = settingsFor({ mode: 'trail', distanceKm: 42, gain: 2500, terrain: TERRAIN });
const trail = generatePlan(trailS, hist(), { today: '2026-12-28' }).plan;
const ctxOf = (s, plan) => ({ thresholds: s.thresholds, coros: emptyCorosZones(), mode: plan.mode, goalPaceSecPerKm: plan.goalPaceSecPerKm });

test('road workout text has numbered steps with pace and heart-rate ranges', () => {
  const w = road.weeks[5].workouts.find((x) => x.code === 'THR');
  const t = workoutText(w, ctxOf(settingsFor(), road), road.weeks[5]);
  assert.match(t, /^\w{3} \d+ \w{3}: Threshold intervals \(THR\), week 6, build/);
  assert.match(t, /1\. Warm-up 12 min at .*\/km, \d+–\d+ bpm/);
  assert.match(t, /2\. \d × \[\d+ min at \d:\d\d–\d:\d\d\/km, 160–166 bpm/);
  assert.match(t, /Total: \d+ min, about [\d.]+ km/);
});

test('trail workout text shows climbing target, RPE and no pace on climbs', () => {
  const week = trail.weeks[9];
  const lr = week.workouts.find((x) => x.role === 'L');
  const t = workoutText(lr, ctxOf(trailS, trail), week);
  assert.match(t, /Climbing target: about \d+ m/);
  assert.match(t, /RPE 3–4/);
  assert.doesNotMatch(t.split('\n')[1], /\/km/);
});

test('week text includes every workout', () => {
  const t = weekText(road.weeks[0], ctxOf(settingsFor(), road));
  assert.ok(t.startsWith('WEEK 1'));
  assert.equal((t.match(/\(EZ\)|\(FAR\)|\(LR\)|\(STRG\)|\(HIL\)/g) || []).length, road.weeks[0].workouts.length);
});

test('CSV has one row per workout and escapes commas and quotes', () => {
  const csv = planCsv(road, ctxOf(settingsFor(), road));
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'date,weekday,week,phase,code,name,steps,total_km,total_min,climb_m');
  const n = road.weeks.reduce((s, w) => s + w.workouts.length, 0);
  assert.ok(lines.length >= n + 1);
  assert.ok(csv.includes('"'));
});

test('race workout exports as a short note', () => {
  const race = road.weeks.at(-1).workouts.find((x) => x.code === 'RACE');
  assert.match(workoutText(race, ctxOf(settingsFor(), road)), /Race/);
});
