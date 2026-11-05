import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, formatPace, parseDuration, parsePace } from '../js/core/units.js';

test('pace formatting and parsing', () => {
  assert.equal(formatPace(330), '5:30');
  assert.equal(formatPace(325.6), '5:26');
  assert.equal(formatPace(null), '–');
  assert.equal(parsePace('5:30'), 330);
  assert.equal(parsePace(' 4:05 '), 245);
  assert.equal(parsePace('5:75'), null);
  assert.equal(parsePace('abc'), null);
  assert.equal(parsePace('530'), null);
});

test('duration formatting and parsing', () => {
  assert.equal(formatDuration(15300), '4:15:00');
  assert.equal(formatDuration(null), '');
  assert.equal(parseDuration('4:15:00'), 15300);
  assert.equal(parseDuration('4:15'), 15300);
  assert.equal(parseDuration('7:30:30'), 27030);
  assert.equal(parseDuration('4:75'), null);
  assert.equal(parseDuration('4'), null);
  assert.equal(parseDuration('x:15'), null);
});
