import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addThresholdEntry, defaultEffectiveFrom, earliestThreshold, removeThresholdEntry, thresholdForDate,
  validateThresholdEntry,
} from '../js/core/thresholds.js';

const today = '2026-11-09';
const first = { effectiveFrom: '2026-11-09', lthr: 168, paceSecPerKm: 330, source: 'manual' };

test('the entry in force is the last one on or before the date', () => {
  const list = [first, { effectiveFrom: '2026-12-15', lthr: 171, paceSecPerKm: 322, source: 'suggested' }];
  assert.equal(thresholdForDate(list, '2026-11-08'), null);
  assert.equal(thresholdForDate(list, '2026-11-09').lthr, 168);
  assert.equal(thresholdForDate(list, '2026-12-14').lthr, 168);
  assert.equal(thresholdForDate(list, '2026-12-15').lthr, 171);
  assert.equal(thresholdForDate(list, '2027-03-01').lthr, 171);
  assert.equal(earliestThreshold(list).effectiveFrom, '2026-11-09');
  assert.equal(earliestThreshold([]), null);
});

test('entries are appended in date order and past dates are refused', () => {
  const a = addThresholdEntry([], first, today);
  assert.deepEqual(a.errors, []);
  const b = addThresholdEntry(a.list, { effectiveFrom: '2026-12-15', lthr: 171, paceSecPerKm: 322 }, today);
  assert.equal(b.list.length, 2);
  assert.equal(b.list[1].source, 'manual');
  const past = addThresholdEntry(b.list, { effectiveFrom: '2026-11-01', lthr: 170, paceSecPerKm: 325 }, today);
  assert.equal(past.errors.length, 1);
  assert.equal(past.list, b.list);
});

test('the first entry may start in the past', () => {
  const r = addThresholdEntry([], { effectiveFrom: '2026-10-01', lthr: 168, paceSecPerKm: null }, today);
  assert.deepEqual(r.errors, []);
  assert.equal(r.list[0].paceSecPerKm, null);
});

test('an entry on an existing date replaces it', () => {
  const r = addThresholdEntry([first], { effectiveFrom: '2026-11-09', lthr: 169, paceSecPerKm: 328 }, today);
  assert.equal(r.list.length, 1);
  assert.equal(r.list[0].lthr, 169);
});

test('entry validation', () => {
  assert.equal(validateThresholdEntry({ effectiveFrom: 'x', lthr: 168 }).length, 1);
  assert.equal(validateThresholdEntry({ effectiveFrom: today, lthr: null, paceSecPerKm: null }).length, 1);
  assert.equal(validateThresholdEntry({ effectiveFrom: today, lthr: 90 }).length, 1);
  assert.equal(validateThresholdEntry({ effectiveFrom: today, lthr: 210 }).length, 1);
  assert.equal(validateThresholdEntry({ effectiveFrom: today, paceSecPerKm: 100 }).length, 1);
  assert.equal(validateThresholdEntry({ effectiveFrom: today, paceSecPerKm: 600 }).length, 1);
  assert.deepEqual(validateThresholdEntry({ effectiveFrom: today, lthr: 168, paceSecPerKm: 330 }), []);
});

test('only entries starting today or later can be removed', () => {
  const later = { effectiveFrom: '2026-12-15', lthr: 171, paceSecPerKm: 322, source: 'manual' };
  const list = [{ ...first, effectiveFrom: '2026-10-01' }, later];
  assert.equal(removeThresholdEntry(list, '2026-10-01', today).length, 2);
  assert.equal(removeThresholdEntry(list, '2026-12-15', today).length, 1);
  assert.equal(defaultEffectiveFrom(today), '2026-11-10');
});

test('an entry with only one value keeps the other from the entry before it', async () => {
  const { addThresholdEntry: add, thresholdForDate: at } = await import('../js/core/thresholds.js');
  const first = add([], { effectiveFrom: '2026-11-01', lthr: 171, paceSecPerKm: 386 }, '2026-11-10').list;
  const paceOnly = add(first, { effectiveFrom: '2026-11-20', lthr: null, paceSecPerKm: 370 }, '2026-11-10');
  assert.deepEqual(paceOnly.errors, []);
  assert.equal(at(paceOnly.list, '2026-12-01').lthr, 171);
  assert.equal(at(paceOnly.list, '2026-12-01').paceSecPerKm, 370);
  const hrOnly = add(paceOnly.list, { effectiveFrom: '2026-12-10', lthr: 174 }, '2026-11-10');
  assert.equal(at(hrOnly.list, '2026-12-11').paceSecPerKm, 370);
  assert.equal(at(hrOnly.list, '2026-11-25').lthr, 171);
});

test('an existing entry can be corrected on its own date, but new past dates are still refused', async () => {
  const { addThresholdEntry: add } = await import('../js/core/thresholds.js');
  const first = add([], { effectiveFrom: '2026-11-01', lthr: 177, paceSecPerKm: 386 }, '2026-11-10').list;
  assert.equal(first.length, 1);
  const fixed = add(first, { effectiveFrom: '2026-11-01', lthr: 171, paceSecPerKm: 386 }, '2026-11-10');
  assert.deepEqual(fixed.errors, []);
  assert.equal(fixed.list.length, 1);
  assert.equal(fixed.list[0].lthr, 171);
  assert.ok(add(first, { effectiveFrom: '2026-11-05', lthr: 171 }, '2026-11-10').errors.length > 0);
});
