import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTargets, prescribedSnapshot } from '../js/core/targets.js';
import { emptyCorosZones } from '../js/core/zones.js';
import { THR_LADDER, thresholdSteps, fartlekSteps, easySteps } from '../js/core/plan/workouts.js';

const ths = [
  { effectiveFrom: '2027-01-04', lthr: 168, paceSecPerKm: 330, source: 'manual' },
  { effectiveFrom: '2027-02-15', lthr: 170, paceSecPerKm: 322, source: 'suggested' },
];
const wk = (date, steps) => ({ id: 'x', date, steps, plannedMin: 50 });
const ctx = (mode = 'road', thresholds = ths) => ({ thresholds, coros: emptyCorosZones(), mode, goalPaceSecPerKm: 340 });

test('scenario 6: a threshold update changes workouts from its effective date only', () => {
  const steps = thresholdSteps(1);
  const before = resolveTargets(wk('2027-02-14', steps), ctx());
  const after = resolveTargets(wk('2027-02-15', steps), ctx());
  const rep = (r) => r.steps.find((s) => s.kind === 'repeat').workTarget;
  assert.deepEqual(rep(before).pace, { fast: 327, slow: 347 });
  assert.deepEqual(rep(before).hr, { lo: 160, hi: 166 });
  assert.deepEqual(rep(after).pace, { fast: 319, slow: 338 });
  assert.deepEqual(rep(after).hr, { lo: 162, hi: 168 });
});

test('snapshot keeps the targets of the day it was taken', () => {
  const w = wk('2027-02-14', thresholdSteps(1));
  const snap = prescribedSnapshot(w, ctx());
  const later = resolveTargets(w, ctx('road', [...ths, { effectiveFrom: '2027-03-01', lthr: 175, paceSecPerKm: 300, source: 'manual' }]));
  assert.equal(snap.thresholdEffectiveFrom, '2027-01-04');
  assert.deepEqual(snap.steps.find((s) => s.kind === 'repeat').workTarget, later.steps.find((s) => s.kind === 'repeat').workTarget);
});

test('scenario 8: no LTHR gives pace-only targets', () => {
  const r = resolveTargets(wk('2027-01-10', thresholdSteps(1)), ctx('road', [{ effectiveFrom: '2027-01-04', lthr: null, paceSecPerKm: 330, source: 'manual' }]));
  const t = r.steps.find((s) => s.kind === 'repeat').workTarget;
  assert.equal(t.hr, null);
  assert.ok(t.pace);
});

test('short work segments mark heart rate as information only', () => {
  const r = resolveTargets(wk('2027-01-10', fartlekSteps(6)), ctx());
  assert.equal(r.steps.find((s) => s.kind === 'repeat').workTarget.hrInfoOnly, true);
  const long = resolveTargets(wk('2027-01-10', thresholdSteps(1)), ctx());
  assert.equal(long.steps.find((s) => s.kind === 'repeat').workTarget.hrInfoOnly, false);
});

test('trail: pace only on flat segments, heart rate and RPE everywhere', () => {
  const flatStep = { kind: 'work', durationMin: 20, zone: 'Z4', flat: true };
  const climbStep = { kind: 'work', durationMin: 20, zone: 'Z4', flat: false };
  const r = resolveTargets(wk('2027-01-10', [flatStep, climbStep]), ctx('trail'));
  assert.ok(r.steps[0].target.pace);
  assert.equal(r.steps[1].target.pace, null);
  assert.deepEqual(r.steps[1].target.hr, { lo: 160, hi: 166 });
  assert.equal(r.steps[1].target.rpe, '6–7');
});

test('race pace resolves from the goal pace, not the thresholds', () => {
  const r = resolveTargets(wk('2027-01-10', [{ kind: 'work', durationMin: 20, zone: 'RP', flat: true }]), ctx());
  assert.deepEqual(r.steps[0].target.pace, { fast: 335, slow: 345 });
});

test('Coros zones override the percentage table when enabled', () => {
  const coros = { enabled: true, hr: { Z1: [null, 140], Z2: [141, 150], Z3: [151, 158], Z4: [159, 165], Z5: [166, null] }, pace: {} };
  const r = resolveTargets(wk('2027-01-10', easySteps(40)), { ...ctx(), coros });
  assert.deepEqual(r.steps[0].target.hr, { lo: 141, hi: 150 });
});
