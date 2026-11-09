import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFeasibility } from '../js/core/plan/feasibility.js';
import { predictRoadTime } from '../js/core/plan/tables.js';

import { START, TERRAIN, hist, settingsFor } from './helpers/plan.js';

test('scenario 1: marathon, 16 weeks, baseline 30, intermediate', () => {
  const r = checkFeasibility(settingsFor(), hist());
  assert.equal(r.status, 'OK', JSON.stringify(r.messages));
  const km = r.params.volume.weeks.map((w) => w.targetKm);
  assert.deepEqual(km, [30, 33, 36, 29, 40, 44, 48, 38, 53, 58, 64, 51, 65, 52, 39, 23]);
  assert.equal(r.params.volume.weeks[12].phase, 'peak');
  assert.equal(r.params.volume.weeks.filter((w) => w.kind === 'taper').length, 3);
});

test('scenario 2: marathon with 8 weeks to go is blocked', () => {
  const r = checkFeasibility(settingsFor({ weeks: 8 }), hist());
  assert.equal(r.status, 'BLOCK');
  assert.match(r.messages[0].text, /12 weeks/);
});

test('scenario 3: half marathon, new, 3 runs, baseline 15 warns about reachable peak', () => {
  const r = checkFeasibility(settingsFor({ distanceKm: 21.0975, weeks: 12, experience: 'new', runs: 3 }), hist({ baselineWeeklyKm: 15, longestRunKm: 8 }));
  assert.equal(r.status, 'WARN');
  assert.equal(r.params.reachableKm, 25);
  assert.ok(r.messages.some((m) => m.code === 'peak'));
});

test('scenario 5: unrealistic marathon goal', () => {
  assert.ok(Math.abs(predictRoadTime(330, 42.195) - 15100) < 60);
  const r = checkFeasibility(settingsFor({ goal: 3.5 * 3600 }), hist());
  assert.equal(r.status, 'WARN');
  assert.ok(r.messages.some((m) => m.code === 'goal' && /unrealistic/.test(m.text)));
});

test('return from break is a warning', () => {
  const r = checkFeasibility(settingsFor(), hist({ baselineWeeklyKm: 18, returnFromBreak: true }));
  assert.ok(r.messages.some((m) => m.code === 'break'));
});

test('half or marathon below the entry minimum is blocked', () => {
  const r = checkFeasibility(settingsFor(), hist({ baselineWeeklyKm: 12 }));
  assert.equal(r.status, 'BLOCK');
});

const trailSettings = (o = {}) => settingsFor({ mode: 'trail', distanceKm: 42, gain: 2500, terrain: TERRAIN, ...o });

test('scenario 9: trail 42 km, 2500 m, 16 weeks', () => {
  const r = checkFeasibility(trailSettings(), hist());
  assert.equal(r.status, 'OK', JSON.stringify(r.messages));
  assert.equal(r.params.peakHours, 8.75);
  assert.equal(r.params.peakVert, 1750);
  assert.equal(r.params.peakLongMin, 270);
  const w = r.params.volume.weeks;
  assert.equal(w[10].targetHours, 8.75); // week 11
  assert.equal(w[13].targetVertM, 1450); // week 14
  assert.equal(w.filter((x) => x.kind === 'taper').length, 2);
});

test('scenario 10: baseline climbing 250 m warns', () => {
  const r = checkFeasibility(trailSettings(), hist({ baselineWeeklyVertM: 250 }));
  assert.equal(r.status, 'WARN');
  assert.equal(r.params.reachableVertM, 1250);
});

test('scenario 11: trail with 8 weeks is blocked', () => {
  assert.equal(checkFeasibility(trailSettings({ weeks: 8 }), hist()).status, 'BLOCK');
});

test('scenario 12: trail without LTHR is blocked', () => {
  const r = checkFeasibility(trailSettings({ lthr: null }), hist());
  assert.equal(r.status, 'BLOCK');
  assert.match(r.messages[0].text, /LTHR/);
});

test('plans longer than 24 weeks hold the baseline first', () => {
  const r = checkFeasibility(settingsFor({ weeks: 30 }), hist());
  const w = r.params.volume.weeks;
  assert.equal(w.slice(0, 6).every((x) => x.kind === 'hold' && x.targetKm === 30), true);
  assert.equal(w.length, 30);
});
