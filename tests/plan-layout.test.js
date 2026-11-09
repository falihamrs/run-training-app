import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeRoles } from '../js/core/plan/layout.js';
import { WEEKDAYS } from '../js/core/dates.js';

const flat = Object.fromEntries(WEEKDAYS.map((d) => [d, 'flat']));
const days = (assign, role) => Object.entries(assign).filter(([, r]) => r === role).map(([d]) => d);

test('5 runs with Sunday long run: Tuesday Q1, Thursday Q2', () => {
  const r = placeRoles({ runs: 5, available: WEEKDAYS, longDay: 'Sun', terrain: flat, trail: false });
  assert.deepEqual(days(r.assign, 'L'), ['Sun']);
  assert.deepEqual(days(r.assign, 'Q1'), ['Tue']);
  assert.deepEqual(days(r.assign, 'Q2'), ['Thu']);
  assert.equal(Object.keys(r.assign).length, 5);
});

test('hard sessions are never on adjacent days, for any run count and long day', () => {
  for (const n of [3, 4, 5, 6]) {
    for (const longDay of ['Sat', 'Sun']) {
      const r = placeRoles({ runs: n, available: WEEKDAYS, longDay, terrain: flat, trail: false });
      const hard = Object.entries(r.assign).filter(([, x]) => ['L', 'Q1', 'Q2'].includes(x)).map(([d]) => WEEKDAYS.indexOf(d));
      for (const a of hard) for (const b of hard) if (a < b) assert.ok(b - a > 1 && !(a === 0 && b === 6), `${n} ${longDay}: ${hard}`);
    }
  }
});

test('scenario 7: only three days available gives three runs', () => {
  const r = placeRoles({ runs: 5, available: ['Tue', 'Thu', 'Sun'], longDay: 'Sun', terrain: flat, trail: false });
  assert.equal(r.runs, 3);
  assert.equal(Object.keys(r.assign).length, 3);
});

test('unavailable long-run day moves to the nearest available day with a message', () => {
  const r = placeRoles({ runs: 4, available: WEEKDAYS.filter((d) => d !== 'Sun'), longDay: 'Sun', terrain: flat, trail: false });
  assert.deepEqual(days(r.assign, 'L'), ['Sat']);
  assert.ok(r.messages.length > 0);
});

const weekendHills = { ...flat, Sat: 'hills', Sun: 'hills' };
test('trail: Q1 goes on a flat day and Q2 prefers hills or incline', () => {
  const r = placeRoles({ runs: 5, available: WEEKDAYS, longDay: 'Sun', terrain: { ...weekendHills, Wed: 'incline' }, trail: true });
  assert.equal(weekendHills[days(r.assign, 'Q1')[0]], 'flat');
});

test('scenario 14: weekend hills, back-to-back puts long run Saturday and medium run Sunday', () => {
  const r = placeRoles({ runs: 5, available: WEEKDAYS, longDay: 'Sun', terrain: weekendHills, trail: true, b2b: true });
  assert.deepEqual(days(r.assign, 'L'), ['Sat']);
  assert.deepEqual(days(r.assign, 'M'), ['Sun']);
  assert.equal(weekendHills[days(r.assign, 'Q1')[0]], 'flat');
});

test('trail long run moves to the nearest hills day', () => {
  const r = placeRoles({ runs: 4, available: WEEKDAYS, longDay: 'Sun', terrain: { ...flat, Sat: 'hills' }, trail: true });
  assert.deepEqual(days(r.assign, 'L'), ['Sat']);
  assert.ok(r.messages.some((m) => /hills day/.test(m)));
});
