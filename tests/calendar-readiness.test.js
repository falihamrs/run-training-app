import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planIcs } from '../js/core/calendar.js';
import { readiness, readinessStatus } from '../js/core/readiness.js';
import { addDays } from '../js/core/dates.js';
import { generatePlan } from '../js/core/plan/generate.js';
import { hist, settingsFor, TERRAIN } from './helpers/plan.js';

const settings = settingsFor({ mode: 'trail', distanceKm: 25, gain: 1200, runs: 4, weeks: 16, terrain: TERRAIN });
const plan = generatePlan(settings, hist(), { today: '2026-12-28' }).plan;
const ctx = { thresholds: settings.thresholds, coros: settings.corosZones, mode: 'trail', goalPaceSecPerKm: null };
const w = (n) => plan.weeks[n - 1];
const all = plan.weeks.flatMap((x) => x.workouts);

test('calendar: one all-day event per workout, valid line format', () => {
  const ics = planIcs(plan, ctx, { stamp: '20261116T120000Z' });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, all.length);
  assert.equal(ics.match(/END:VEVENT/g).length, all.length);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.ok(!/[^\r]\n/.test(ics), 'only CRLF line ends');
  const uids = ics.match(/^UID:.*$/gm);
  assert.equal(new Set(uids).size, uids.length, 'UIDs are unique');
  const first = all[0];
  assert.ok(ics.includes(`DTSTART;VALUE=DATE:${first.date.replace(/-/g, '')}`));
  assert.ok(ics.includes(`DTEND;VALUE=DATE:${addDays(first.date, 1).replace(/-/g, '')}`));
  assert.match(ics, /SUMMARY:RACE: /);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /DESCRIPTION:[^\r]*\\n1\. /, 'steps are in the description with escaped line breaks');
  assert.ok(!/DESCRIPTION:[^\r]*[^\\],/.test(unfolded), 'commas are escaped');
});

test('calendar honours a date range', () => {
  const r = { from: w(2).start, to: addDays(w(2).start, 6) };
  const ics = planIcs(plan, ctx, { range: r });
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, w(2).workouts.length);
});

test('readiness status thresholds', () => {
  assert.equal(readinessStatus(5, null), 'none');
  assert.equal(readinessStatus(85, 100), 'ok');
  assert.equal(readinessStatus(70, 100), 'near');
  assert.equal(readinessStatus(59, 100), 'behind');
});

test('readiness: before the plan starts there is nothing to compare with', () => {
  const r = readiness(plan, [], addDays(plan.startDate, -3));
  assert.equal(r.planWeeks, 0);
  assert.equal(r.overall, 'none');
  assert.ok(r.rows.every((x) => x.planned == null && x.status === 'none'));
  assert.equal(readiness(null, [], '2027-01-01'), null);
});

test('readiness: runs that follow the plan are on track, no runs are behind', () => {
  const today = addDays(w(6).start, 2);
  const done = [1, 2, 3, 4, 5].flatMap((n) => w(n).workouts.filter((x) => x.role !== 'S').map((x, i) => ({ id: n * 10 + i, date: x.date, distanceKm: 8, movingSec: x.plannedMin * 60, gainM: x.plannedVertM ?? 0 })));
  const good = readiness(plan, done, today);
  assert.equal(good.rows.find((x) => x.key === 'hours').now, good.rows.find((x) => x.key === 'hours').planned);
  assert.equal(good.planWeeks, 4);
  assert.deepEqual(good.window, { from: w(2).start, to: addDays(w(5).start, 6) });
  assert.equal(good.overall, 'ok');
  const long = good.rows.find((x) => x.key === 'long');
  assert.equal(long.now, long.planned);
  assert.equal(long.peak, plan.peak.longRunMin);
  assert.ok(good.weeksToRace > 0);
  const early = readiness(plan, [{ id: 1, date: addDays(plan.startDate, -2), distanceKm: 30, movingSec: 4 * 3600, gainM: 900 }, ...done.filter((r) => r.date <= addDays(w(1).start, 6))], addDays(w(2).start, 1));
  assert.equal(early.planWeeks, 1);
  assert.deepEqual(early.window, { from: w(1).start, to: addDays(w(1).start, 6) }, 'only finished plan weeks count once there is one');
  const none = readiness(plan, [], today);
  assert.equal(none.overall, 'behind');
  const half = readiness(plan, done.map((r) => ({ ...r, movingSec: r.movingSec * 0.7, gainM: r.gainM * 0.7 })), today);
  assert.equal(half.overall, 'near');
});

test('readiness: road plans compare kilometres', () => {
  const s = settingsFor({ mode: 'road', distanceKm: 21.1, runs: 4, weeks: 16 });
  const p = generatePlan(s, hist(), { today: '2026-12-28' }).plan;
  const r = readiness(p, [], addDays(p.weeks[5].start, 1));
  assert.deepEqual(r.rows.map((x) => x.key), ['long', 'km']);
  assert.ok(r.rows.every((x) => x.planned > 0 && x.peak > 0));
});
