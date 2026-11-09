import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, integrityReport, runsInRange } from '../js/core/housekeeping.js';

const runs = [
  { id: 1, date: '2026-01-05', race: false },
  { id: 2, date: '2026-02-10', race: true },
  { id: 3, date: '2026-03-01', race: false },
  { id: 4, date: '2026-03-20', race: false, matchedWorkoutId: 'w1-Mon' },
];

test('range selection is inclusive, open-ended, and keeps races by default', () => {
  assert.deepEqual(runsInRange(runs, '', '').map((r) => r.id), []);
  assert.deepEqual(runsInRange(runs, '', '2026-03-01').map((r) => r.id), [1, 3]);
  assert.deepEqual(runsInRange(runs, '2026-02-10', '2026-03-01', { keepRaces: false }).map((r) => r.id), [2, 3]);
  assert.deepEqual(runsInRange(runs, '2026-03-01', '').map((r) => r.id), [3, 4]);
  assert.deepEqual(runsInRange(runs, '2027-01-01', '').map((r) => r.id), []);
});

test('integrity report finds leftover streams and dangling matches', () => {
  const plan = { weeks: [{ workouts: [{ id: 'w1-Mon' }, { id: 'w1-Tue' }] }] };
  const ok = integrityReport({ runs, streamIds: [1, 2, 3, 4], plan });
  assert.deepEqual(ok, { orphanStreams: [], danglingMatches: [], missingStreams: [], fixable: 0 });
  const bad = integrityReport({ runs, streamIds: [1, 3, 99, 100], plan: { weeks: [{ workouts: [{ id: 'w1-Tue' }] }] } });
  assert.deepEqual(bad.orphanStreams, [99, 100]);
  assert.deepEqual(bad.danglingMatches, [4]);
  assert.deepEqual(bad.missingStreams, [2, 4]);
  assert.equal(bad.fixable, 3);
  // no plan at all: every match is dangling
  assert.deepEqual(integrityReport({ runs, streamIds: [1, 2, 3, 4], plan: null }).danglingMatches, [4]);
});

test('formatBytes picks a readable unit', () => {
  assert.equal(formatBytes(null), 'unknown');
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});
