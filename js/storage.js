// IndexedDB storage via Dexie. Tables follow section 9 of the spec; milestone 1 only
// writes `settings`, the others are created now so later milestones need no migration.

import Dexie from './vendor/dexie.mjs';
import { SETTINGS_VERSION, defaultSettings } from './core/defaults.js';

export const BACKUP_APP = 'run-training-app';

export function openDb(name = 'RunTrainingApp') {
  const db = new Dexie(name);
  db.version(1).stores({
    settings: 'key',
    plans: 'id',
    runs: '++id, date',
    streams: 'runId',
  });
  return db;
}

/** Fill in any field missing from older or partial saved data. */
export function withDefaults(value, today) {
  const d = defaultSettings(today);
  const v = value ?? {};
  return {
    ...d,
    ...v,
    version: SETTINGS_VERSION,
    athlete: { ...d.athlete, ...v.athlete },
    race: { ...d.race, ...v.race },
    schedule: {
      ...d.schedule,
      ...v.schedule,
      dayTerrain: { ...d.schedule.dayTerrain, ...v.schedule?.dayTerrain },
      unavailableDays: v.schedule?.unavailableDays ?? [],
    },
    thresholds: Array.isArray(v.thresholds) ? v.thresholds : [],
    corosZones: { ...d.corosZones, ...v.corosZones },
  };
}

export async function loadSettings(db, today) {
  const row = await db.settings.get('main');
  return { settings: withDefaults(row?.value, today), isNew: !row, savedAt: row?.savedAt ?? null };
}

export async function saveSettings(db, settings) {
  const savedAt = new Date().toISOString();
  await db.settings.put({ key: 'main', value: settings, savedAt });
  return savedAt;
}

/** Everything except the downsampled streams, which can be re-imported from the TCX files. */
export async function exportBackup(db) {
  const row = await db.settings.get('main');
  return {
    app: BACKUP_APP,
    version: SETTINGS_VERSION,
    exportedAt: new Date().toISOString(),
    settings: row?.value ?? null,
    plans: await db.plans.toArray(),
    runs: await db.runs.toArray(),
  };
}

/** Throws an Error with a readable message when the file is not a valid backup. */
export async function importBackup(db, data, today) {
  if (!data || data.app !== BACKUP_APP) throw new Error('This file is not a backup from this app.');
  if (typeof data.version !== 'number' || data.version > SETTINGS_VERSION) {
    throw new Error('This backup was made by a newer version of the app.');
  }
  if (!data.settings || typeof data.settings !== 'object') throw new Error('The backup contains no settings.');
  const settings = withDefaults(data.settings, today);
  await db.transaction('rw', db.settings, db.plans, db.runs, async () => {
    await db.settings.put({ key: 'main', value: settings, savedAt: new Date().toISOString() });
    await db.plans.clear();
    await db.runs.clear();
    if (Array.isArray(data.plans) && data.plans.length) await db.plans.bulkPut(data.plans);
    if (Array.isArray(data.runs) && data.runs.length) await db.runs.bulkPut(data.runs);
  });
  return settings;
}

export async function requestPersistence() {
  if (navigator.storage?.persist) return navigator.storage.persist();
  return false;
}

export async function isPersisted() {
  if (navigator.storage?.persisted) return navigator.storage.persisted();
  return false;
}
