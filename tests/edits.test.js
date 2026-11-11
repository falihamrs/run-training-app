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

// ---- swapping two workouts of one week
const futureWeek = (p) => p.weeks.find((w) => w.n >= 3 && w.workouts.filter((x) => x.role !== 'S' && x.role !== 'RACE' && x.date > today).length >= 3);

test('swap: two runs trade days, ids and terrain, totals stay, undo restores', () => {
  const week = futureWeek(road);
  const [a, b] = week.workouts.filter((x) => x.role !== 'S' && x.role !== 'RACE');
  const r = applyChanges(road, [{ op: 'swap', workout: a.id, with: b.id }], { today });
  assert.ok(r.results[0].ok, r.results[0].error);
  const nw = wk(r.plan, week.n);
  const na = nw.workouts.find((x) => x.code === a.code && x.plannedMin === a.plannedMin);
  const nb = nw.workouts.find((x) => x.code === b.code && x.plannedMin === b.plannedMin);
  assert.deepEqual([na.date, na.weekday, na.id], [b.date, b.weekday, `w${week.n}-${b.weekday}`]);
  assert.deepEqual([nb.date, nb.weekday, nb.id], [a.date, a.weekday, `w${week.n}-${a.weekday}`]);
  assert.ok(na.edited && nb.edited);
  assert.equal(nw.plannedMin, week.plannedMin);
  assert.equal(nw.plannedKm, week.plannedKm);
  assert.deepEqual(nw.workouts.map((x) => x.date), [...nw.workouts.map((x) => x.date)].sort());
  assert.equal(new Set(r.plan.weeks.flatMap((w) => w.workouts.map((x) => x.id))).size, r.plan.weeks.flatMap((w) => w.workouts).length);
  assert.match(r.plan.edits.at(-1).summary, /swapped with/);
  assert.equal(get(road, a.id).date, a.date); // original untouched
  assert.deepEqual(undoLast(r.plan).weeks, road.weeks);
});

test('swap: refused across weeks, run with strength, past, same workout, matched run, AI this week', () => {
  const week = futureWeek(road);
  const runsW = week.workouts.filter((x) => x.role !== 'S' && x.role !== 'RACE');
  const [a, b] = runsW;
  const err = (c, opts = {}) => applyChange(road, c, { today, ...opts }).error;
  const other = wk(road, week.n + 1).workouts.find((x) => x.role === 'E');
  assert.match(err({ op: 'swap', workout: a.id, with: other.id }), /within one week/);
  const strength = road.weeks.flatMap((w) => w.workouts).find((x) => x.role === 'S' && x.date > today);
  if (strength) {
    const sameWeekRun = wk(road, strength.week).workouts.find((x) => x.role === 'E');
    assert.match(err({ op: 'swap', workout: strength.id, with: sameWeekRun.id }), /run with a run/);
  }
  assert.match(err({ op: 'swap', workout: a.id, with: a.id }), /two different/);
  assert.match(err({ op: 'swap', workout: a.id }), /other workout/);
  assert.match(err({ op: 'swap', workout: a.id, with: 'w99-Mon' }), /no workout/);
  const past = wk(road, 1).workouts.find((x) => x.role !== 'S' && x.date < today);
  if (past) assert.match(err({ op: 'swap', workout: past.id, with: wk(road, 1).workouts.find((x) => x.role === 'E' && x.date > today).id }), /past/);
  assert.match(err({ op: 'swap', workout: a.id, with: b.id }, { runs: [{ matchedWorkoutId: b.id }] }), /matched/);
  const cur = wk(road, 1).workouts.filter((x) => x.role !== 'S' && x.role !== 'RACE' && x.date > today);
  if (cur.length >= 2) assert.match(err({ op: 'swap', workout: cur[0].id, with: cur[1].id }, { source: 'ai' }), /next Monday/);
});

test('swap: a climbing run going to a flat day warns by hand and is refused from an AI', () => {
  const week = trail.weeks.find((w) => w.n >= 4 && w.workouts.some((x) => x.role === 'L' && x.plannedVertM > 0));
  const long = week.workouts.find((x) => x.role === 'L');
  const flat = week.workouts.find((x) => x.role !== 'S' && x.role !== 'L' && x.terrain === 'flat' && !x.plannedVertM);
  assert.ok(long && flat, 'the plan has a climbing long run and a flat-day run in one week');
  const hand = applyChange(trail, { op: 'swap', workout: long.id, with: flat.id }, { today });
  assert.ok(hand.ok, hand.error);
  assert.ok(hand.warnings.some((m) => /flat day/.test(m)), hand.warnings.join(' | '));
  const ai = applyChange(trail, { op: 'swap', workout: long.id, with: flat.id }, { today, source: 'ai' });
  assert.equal(ai.ok, false);
  assert.match(ai.error, /flat day/);
  // moving it by hand to a free flat day gets the same warning
  const free = ['Mon', 'Tue', 'Thu'].find((d) => trail.settingsSnapshot.dayTerrain[d] === 'flat' && !week.workouts.some((x) => x.weekday === d && x.role !== 'S'));
  assert.ok(free, 'the week has a free flat day');
  const mv = applyChange(trail, { op: 'move', workout: long.id, to: free }, { today });
  assert.ok(mv.ok, mv.error);
  assert.ok(mv.warnings.some((m) => /flat day/.test(m)), mv.warnings.join(' | '));
});
