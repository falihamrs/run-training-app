import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, diffDays, isValidDate, mondayOnOrBefore, nextMonday, weekdayOf, todayLocal } from '../js/core/dates.js';

test('isValidDate accepts real dates only', () => {
  assert.equal(isValidDate('2026-11-09'), true);
  assert.equal(isValidDate('2027-02-29'), false);
  assert.equal(isValidDate('2026-13-01'), false);
  assert.equal(isValidDate('2026-1-1'), false);
  assert.equal(isValidDate(null), false);
});

test('weekday and Monday helpers', () => {
  assert.equal(weekdayOf('2026-11-09'), 'Mon');
  assert.equal(weekdayOf('2026-11-15'), 'Sun');
  assert.equal(mondayOnOrBefore('2026-11-15'), '2026-11-09');
  assert.equal(mondayOnOrBefore('2026-11-09'), '2026-11-09');
  assert.equal(nextMonday('2026-11-09'), '2026-11-16');
  assert.equal(nextMonday('2026-11-05'), '2026-11-09');
});

test('addDays and diffDays cross month, year and leap-day boundaries', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-11-09', 105), '2027-02-22');
  assert.equal(diffDays('2026-11-09', '2027-02-28'), 111);
  assert.equal(diffDays('2027-02-28', '2026-11-09'), -111);
});

test('todayLocal uses the local calendar date', () => {
  assert.equal(todayLocal(new Date(2026, 10, 5, 23, 59)), '2026-11-05');
  assert.equal(todayLocal(new Date(2026, 10, 6, 0, 1)), '2026-11-06');
});

test('activity time zone: browser offset unless the run was recorded far away', async () => {
  const { activityTzOffsetMin, localDateOfMs } = await import('../js/core/dates.js');
  assert.equal(activityTzOffsetMin(420, 100.5), 420); // Bangkok at home
  assert.equal(activityTzOffsetMin(420, null), 420); // treadmill, no GPS
  assert.equal(activityTzOffsetMin(420, 139.7), 420); // Tokyo is 2 h away: keep the browser zone
  assert.equal(activityTzOffsetMin(420, -74), -300); // New York
  assert.equal(activityTzOffsetMin(480, 76), 480); // western China keeps its single official zone
  // 06:30 in New York on 3 May is still 3 May there, although it is already evening in Bangkok
  const ms = Date.parse('2026-05-03T10:30:00Z');
  assert.equal(localDateOfMs(ms, activityTzOffsetMin(420, -74)), '2026-05-03');
  assert.equal(localDateOfMs(Date.parse('2026-05-03T22:30:00Z'), 420), '2026-05-04');
});
