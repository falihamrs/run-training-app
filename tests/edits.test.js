import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChange, applyChanges, canUndo, editsLostByRegen, lockReason, undoLast } from '../js/core/edits.js';
import { addDays, diffDays, nextMonday } from '../js/core/dates.js';
import { generatePlan } from '../js/core/plan/generate.js';
import * as W from '../js/core/plan/workouts.js';
import { TERRAIN, hist, settingsFor } from './helpers/plan.js';

const trail = generatePlan(settingsFor({ mode: 'trail', distanceKm: 25, gain: 1200, runs: 4, weeks: 16, terrain: TERRAIN }), hist(), { today: '2026-12-28' }).plan;
const road = generatePlan(settingsFor({ distanceKm: 21.1, runs: 4, weeks: 12 }), hist(), { today: '2026-12-28' }).plan;
const today = addDays(trail.startDate, 2); // Wednesday of week 1
const wk = (p, n) => p.weeks[n - 1];
const get = (p, id) => p.weeks.flatMap((w) => w.workouts).find((w) => w.id === id);
const sum = (week) => week.workouts.filter((x) => x.role !== 'S' && x.role !== 'RACE').reduce((s, x) => s + x.plannedMin, 0);

test('locks: past, the race, matched runs, and the current week for AI changes', () => {
  const past = wk(trail, 1).workouts.find((w) => w.date < today);
  if (past) assert.match(lockReason(trail, past.id, { today }), /past/);
  assert.match(lockReason(trail, 'race', { today }), /race cannot/);
  const later = wk(trail, 1).workouts.find((w) => w.date > today && w.role !== 'S');
  assert.equal(lockReason(trail, later.id, { today }), null);
  assert.match(lockReason(trail, later.id, { today, source: 'ai' }), /next Monday/);
  assert.match(lockReason(trail, later.id, { today, runs: [{ matchedWorkoutId: later.id }] }), /matched/);
  assert.match(lockReason(trail, 'w99-Mon', { today }), /no workout/);
});

test('easy run longer and shorter keeps the week totals and climbing rules', () => {
  const e = wk(trail, 3).workouts.find((w) => w.role === 'E');
  const r = applyChange(trail, { op: 'duration', workout: e.id, minutes: e.plannedMin + 10 }, { today });
  assert.ok(r.ok, r.error);
  const w = get(r.plan, e.id);
  assert.equal(w.plannedMin, e.plannedMin + 10);
  assert.equal(W.totalMinutes(w.steps), w.plannedMin);
  assert.equal(wk(r.plan, 3).plannedMin, sum(wk(r.plan, 3)));
  assert.ok(!w.plannedVertM || w.plannedVertM <= (400 * w.plannedMin) / 60);
  assert.equal(w.edited, true);
  assert.equal(r.plan.edits.at(-1).summary.includes(`${e.plannedMin} → ${e.plannedMin + 10} min`), true);
  // the original plan is untouched
  assert.equal(get(trail, e.id).plannedMin, e.plannedMin);
});

test('quality sessions only get shorter; too short is refused with a hint', () => {
  const q = wk(trail, 6).workouts.find((w) => w.role === 'Q1' || w.role === 'Q2');
  const longer = applyChange(trail, { op: 'duration', workout: q.id, minutes: q.plannedMin + 10 }, { today });
  assert.equal(longer.ok, false);
  assert.match(longer.error, /shorter, not longer/);
  const shorter = applyChange(trail, { op: 'duration', workout: q.id, minutes: q.plannedMin - 5 }, { today });
  assert.ok(shorter.ok, shorter.error);
  assert.ok(get(shorter.plan, q.id).plannedMin <= q.plannedMin - 3);
  const tiny = applyChange(trail, { op: 'duration', workout: q.id, minutes: 15 }, { today });
  assert.ok(tiny.ok || /cannot be shorter than about \d+ minutes/.test(tiny.error));
});

test('move within the week: id and terrain follow, clashes and hard neighbours are caught', () => {
  const week = wk(trail, 5);
  const days = new Set(week.workouts.filter((w) => w.role !== 'S').map((w) => w.weekday));
  const e = week.workouts.find((w) => w.role === 'E');
  const free = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].find((d) => !days.has(d) && addDays(week.start, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(d)) >= today);
  const r = applyChange(trail, { op: 'move', workout: e.id, to: free }, { today });
  assert.ok(r.ok, r.error);
  const moved = get(r.plan, `w5-${free}`);
  assert.ok(moved && moved.weekday === free && diffDays(week.start, moved.date) === ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(free));
  assert.equal(moved.terrain, TERRAIN[free]);
  assert.ok(!get(r.plan, e.id));
  const busy = week.workouts.find((w) => w.role !== 'S' && w !== e);
  assert.match(applyChange(trail, { op: 'move', workout: e.id, to: busy.weekday }, { today }).error, /already has/);
  assert.match(applyChange(trail, { op: 'move', workout: e.id, to: 'Funday' }, { today }).error, /weekday/);
  // a quality session moved next to the long run: allowed by hand with a warning, refused from an AI
  const q = week.workouts.find((w) => w.role === 'Q1' || w.role === 'Q2');
  const long = week.workouts.find((w) => w.role === 'L');
  const beside = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(long.weekday) + 6) % 7];
  if (!week.workouts.some((w) => w.weekday === beside && w.role !== 'S') && addDays(long.date, -1) >= today) {
    const m = applyChange(trail, { op: 'move', workout: q.id, to: beside }, { today });
    assert.ok(m.ok && m.warnings.some((x) => /next to/.test(x)));
    const ai = applyChange(trail, { op: 'move', workout: q.id, to: beside }, { today: addDays(trail.startDate, -3), source: 'ai' });
    assert.equal(ai.ok, false);
    assert.match(ai.error, /next to/);
  }
});

test('make easy, rest day, and the weekly limit', () => {
  const q = wk(road, 4).workouts.find((w) => w.role === 'Q1');
  const easy = applyChange(road, { op: 'easy', workout: q.id }, { today: road.startDate });
  assert.ok(easy.ok, easy.error);
  const e = get(easy.plan, q.id);
  assert.equal(e.code, 'EZ');
  assert.equal(e.plannedMin, Math.min(q.plannedMin, 45));
  assert.ok(e.plannedKm > 0 && Math.abs(e.plannedKm - (e.plannedMin * 60) / road.easyPaceSecPerKm) < 0.1);
  const rest = applyChange(road, { op: 'rest', workout: q.id }, { today: road.startDate });
  assert.ok(!get(rest.plan, q.id));
  assert.equal(wk(rest.plan, 4).plannedKm < wk(road, 4).plannedKm, true);
  // a long run pushed far beyond the target week: warning by hand, refused from an AI
  const l = wk(road, 4).workouts.find((w) => w.role === 'L');
  const big = applyChange(road, { op: 'duration', workout: l.id, minutes: l.plannedMin + 60 }, { today: road.startDate });
  assert.ok(big.ok && big.warnings.length >= 1);
  const bigAi = applyChange(road, { op: 'duration', workout: l.id, minutes: l.plannedMin + 60 }, { today: addDays(road.startDate, -7), source: 'ai' });
  assert.equal(bigAi.ok, false);
});

test('scale a week, batches, undo, and edits lost by regenerating', () => {
  const before = wk(road, 6).plannedKm;
  const r = applyChanges(road, [
    { op: 'scaleWeek', week: 6, factor: 0.8, reason: 'tired' },
    { op: 'rest', workout: 'w99-Mon' },
    { op: 'scaleWeek', week: 7, factor: 2 },
  ], { today: road.startDate });
  assert.deepEqual(r.results.map((x) => x.ok), [true, false, false]);
  assert.ok(wk(r.plan, 6).plannedKm < before * 0.9);
  for (const w of wk(r.plan, 6).workouts) if (w.role !== 'S' && w.role !== 'RACE') assert.equal(W.totalMinutes(w.steps), w.plannedMin);
  assert.equal(r.plan.edits.at(-1).reason, 'tired');
  assert.ok(canUndo(r.plan));
  const back = undoLast(r.plan);
  assert.equal(wk(back, 6).plannedKm, before);
  assert.equal(canUndo(back), false);
  assert.ok(editsLostByRegen(r.plan, wk(road, 5).start) > 0);
  assert.equal(editsLostByRegen(r.plan, wk(road, 8).start), 0);
});
