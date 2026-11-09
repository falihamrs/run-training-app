import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateBackup } from '../js/storage.js';

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

test('service worker precaches every script and stylesheet', () => {
  const sw = readFileSync('sw.js', 'utf8');
  const files = [...walk('js'), ...walk('css')].filter((f) => /\.(js|mjs|css)$/.test(f));
  const missing = files.filter((f) => !sw.includes(`"./${f.replace(/\\/g, '/')}"`));
  assert.deepEqual(missing, []);
});

test('index.html loads the app module', () => {
  assert.match(readFileSync('index.html', 'utf8'), /js\/app\.js/);
});

test('backup validation accepts a good file and rejects damaged ones', () => {
  const ok = { app: 'run-training-app', version: 1, settings: {}, plans: [{ id: 'main', weeks: [] }], runs: [{ date: '2026-01-01', distanceKm: 5 }] };
  assert.doesNotThrow(() => validateBackup(ok));
  assert.throws(() => validateBackup(null), /not a backup/);
  assert.throws(() => validateBackup({ ...ok, app: 'other' }), /not a backup/);
  assert.throws(() => validateBackup({ ...ok, version: 99 }), /newer version/);
  assert.throws(() => validateBackup({ ...ok, settings: null }), /no settings/);
  assert.throws(() => validateBackup({ ...ok, plans: [{ id: 'x' }] }), /plans/);
  assert.throws(() => validateBackup({ ...ok, runs: [{ date: 5 }] }), /runs/);
});
