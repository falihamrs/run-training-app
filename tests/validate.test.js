import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../js/core/defaults.js';
import { validateSettings } from '../js/core/validate.js';

const today = '2026-11-05';

function trailSettings(patch = {}) {
  const s = defaultSettings(today);
  s.race = { ...s.race, mode: 'trail', date: '2027-02-28', distanceKm: 42, elevationGainM: 2500 };
  s.schedule = {
    ...s.schedule,
    dayTerrain: { ...s.schedule.dayTerrain, Sat: 'hills', Sun: 'hills' },
  };
  s.thresholds = [{ effectiveFrom: '2026-11-05', lthr: 168, paceSecPerKm: null, source: 'manual' }];
  return { ...s, ...patch };
}
const fields = (list) => list.map((e) => e.field);

test('a complete trail setup has no errors', () => {
  const r = validateSettings(trailSettings(), { today });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.normalized.schedule.startDate, '2026-11-09');
  assert.equal(r.effectiveRunsPerWeek, 5);
});

test('defaults need a race and thresholds', () => {
  const r = validateSettings(defaultSettings(today), { today });
  assert.ok(fields(r.errors).includes('race.date'));
  assert.ok(fields(r.errors).includes('race.distanceKm'));
  assert.ok(fields(r.errors).includes('thresholds'));
});

test('trail needs LTHR; road needs pace', () => {
  const trail = trailSettings({ thresholds: [{ effectiveFrom: '2026-11-05', lthr: null, paceSecPerKm: 330, source: 'manual' }] });
  assert.ok(fields(validateSettings(trail, { today }).errors).includes('thresholds'));

  const road = trailSettings();
  road.race = { ...road.race, mode: 'road', distanceKm: 42.195, elevationGainM: 0 };
  const r = validateSettings(road, { today });
  assert.ok(fields(r.errors).includes('thresholds'));
  road.thresholds = [{ effectiveFrom: '2026-11-05', lthr: null, paceSecPerKm: 330, source: 'manual' }];
  const r2 = validateSettings(road, { today });
  assert.deepEqual(r2.errors, []);
  assert.ok(fields(r2.warnings).includes('thresholds')); // pace-only targets
});

test('distance ranges depend on mode', () => {
  const s = trailSettings();
  s.race.distanceKm = 50;
  assert.ok(fields(validateSettings(s, { today }).errors).includes('race.distanceKm'));
  s.race.mode = 'road';
  s.thresholds = [{ effectiveFrom: '2026-11-05', lthr: 168, paceSecPerKm: 330, source: 'manual' }];
  assert.deepEqual(validateSettings(s, { today }).errors, []);
  s.race.distanceKm = 2;
  assert.ok(fields(validateSettings(s, { today }).errors).includes('race.distanceKm'));
});

test('elevation gain is limited to 100 m per km', () => {
  const s = trailSettings();
  s.race.elevationGainM = 4600;
  assert.ok(fields(validateSettings(s, { today }).errors).includes('race.elevationGainM'));
  s.race.elevationGainM = -5;
  assert.ok(fields(validateSettings(s, { today }).errors).includes('race.elevationGainM'));
});

test('race date must be in the future and after the start date', () => {
  const s = trailSettings();
  s.race.date = '2026-11-05';
  assert.ok(fields(validateSettings(s, { today }).errors).includes('race.date'));
  s.race.date = '2026-11-20';
  s.schedule.startDate = '2026-11-23';
  assert.ok(fields(validateSettings(s, { today }).errors).includes('race.date'));
});

test('start date is snapped to a Monday with a warning', () => {
  const s = trailSettings();
  s.schedule.startDate = '2026-11-11';
  const r = validateSettings(s, { today });
  assert.equal(r.normalized.schedule.startDate, '2026-11-09');
  assert.ok(fields(r.warnings).includes('schedule.startDate'));
});

test('unavailable days reduce runs per week', () => {
  const s = trailSettings();
  s.schedule.unavailableDays = ['Mon', 'Tue', 'Thu', 'Fri'];
  const r = validateSettings(s, { today });
  assert.deepEqual(r.errors, []);
  assert.equal(r.effectiveRunsPerWeek, 3);
  assert.ok(fields(r.warnings).includes('schedule.unavailableDays'));
  s.schedule.unavailableDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  assert.ok(fields(validateSettings(s, { today }).errors).includes('schedule.unavailableDays'));
});

test('long run day rules', () => {
  const s = trailSettings();
  s.schedule.unavailableDays = ['Sun'];
  assert.ok(fields(validateSettings(s, { today }).errors).includes('schedule.longRunDay'));
  s.schedule.unavailableDays = [];
  s.schedule.longRunDay = 'Wed';
  const r = validateSettings(s, { today });
  assert.deepEqual(r.errors, []);
  assert.ok(fields(r.warnings).includes('schedule.longRunDay'));
});

test('terrain warnings for a high-climbing race', () => {
  const s = trailSettings();
  s.schedule.dayTerrain = { Mon: 'flat', Tue: 'flat', Wed: 'flat', Thu: 'flat', Fri: 'flat', Sat: 'flat', Sun: 'flat' };
  let r = validateSettings(s, { today });
  assert.match(r.warnings.find((w) => w.field === 'schedule.dayTerrain').message, /cannot be placed/);
  s.schedule.dayTerrain.Wed = 'incline';
  r = validateSettings(s, { today });
  assert.match(r.warnings.find((w) => w.field === 'schedule.dayTerrain').message, /incline sessions/);
});

test('strength sessions accept 0-2 or the default', () => {
  const s = trailSettings();
  s.schedule.strengthSessions = 3;
  assert.ok(fields(validateSettings(s, { today }).errors).includes('schedule.strengthSessions'));
  s.schedule.strengthSessions = 0;
  assert.deepEqual(validateSettings(s, { today }).errors, []);
});

test('goal time slower than cut-off gives a warning', () => {
  const s = trailSettings();
  s.race.goalTimeSec = 30000;
  s.race.cutoffSec = 28800;
  assert.ok(fields(validateSettings(s, { today }).warnings).includes('race.goalTimeSec'));
});

test('invalid Coros zones block saving', () => {
  const s = trailSettings();
  s.corosZones = { enabled: true, hr: { Z1: [null, 120] }, pace: {} };
  assert.ok(fields(validateSettings(s, { today }).errors).some((f) => f.startsWith('corosZones')));
});

import { climbDensity, kmEffort } from '../js/core/race.js';

test('km-effort and climb density for a 42 km race with 2,500 m of gain', () => {
  assert.equal(Math.round(kmEffort(42, 2500)), 67);
  assert.equal(Math.round(climbDensity(42, 2500)), 60);
  assert.equal(kmEffort(21.0975, 0), 21.0975);
  assert.equal(climbDensity(0, 100), 0);
});
