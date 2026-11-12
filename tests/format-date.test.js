import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtDate } from '../js/ui/util.js';

test('fmtDate shows one readable style and leaves other input alone', () => {
  assert.equal(fmtDate('2026-11-16'), '16 Nov 2026');
  assert.equal(fmtDate('2026-11-16', 'short'), '16 Nov');
  assert.equal(fmtDate('2026-11-16', 'day'), 'Mon 16 Nov');
  assert.equal(fmtDate('2027-03-07', 'day'), 'Sun 7 Mar');
  assert.equal(fmtDate(''), '');
  assert.equal(fmtDate('not a date'), 'not a date');
});
