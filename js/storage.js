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
    selfReport: (await db.settings.get('selfReport'))?.value ?? null,
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
  await db.transaction('rw', db.settings, db.plans, db.runs, db.streams, async () => {
    await db.settings.put({ key: 'main', value: settings, savedAt: new Date().toISOString() });
    await db.plans.clear();
    await db.runs.clear();
    await db.streams.clear();
    if (Array.isArray(data.plans) && data.plans.length) await db.plans.bulkPut(data.plans);
    if (Array.isArray(data.runs) && data.runs.length) await db.runs.bulkPut(data.runs);
    if (data.selfReport) await db.settings.put({ key: 'selfReport', value: data.selfReport, savedAt: new Date().toISOString() });
  });
  return settings;
}

// ---------- runs (milestone 2) ----------

/** Store an analysed run and its stream unless the same activity is already stored. */
export async function addRun(db, run, stream) {
  const existing = await db.runs.toArray();
  const dup = existing.find((r) => r.fingerprint === run.fingerprint
    || (Math.abs(r.startTime - run.startTime) <= 60000 && Math.abs(r.distanceKm - run.distanceKm) <= 0.02 * Math.max(r.distanceKm, run.distanceKm)));
  if (dup) return { added: false, duplicateOf: dup.id };
  const id = await db.runs.add(run);
  await db.streams.put({ runId: id, ...stream });
  return { added: true, id };
}

export async function listRuns(db) {
  return (await db.runs.orderBy('date').toArray()).sort((a, b) => a.startTime - b.startTime);
}

export async function updateRun(db, id, changes) {
  await db.runs.update(id, changes);
}

export async function deleteRun(db, id) {
  await db.transaction('rw', db.runs, db.streams, async () => {
    await db.runs.delete(id);
    await db.streams.delete(id);
  });
}

export async function loadSelfReport(db) {
  return (await db.settings.get('selfReport'))?.value ?? null;
}

export async function saveSelfReport(db, value) {
  await db.settings.put({ key: 'selfReport', value, savedAt: new Date().toISOString() });
}

// ---------- plans (milestone 4) ----------

export async function savePlan(db, plan) {
  await db.plans.put({ ...plan, savedAt: new Date().toISOString() });
}

export async function loadPlan(db, id = 'main') {
  return (await db.plans.get(id)) ?? null;
}

export async function deletePlan(db, id = 'main') {
  await db.plans.delete(id);
}

export async function loadSuggestState(db) {
  return (await db.settings.get('suggestState'))?.value ?? {};
}

export async function saveSuggestState(db, value) {
  await db.settings.put({ key: 'suggestState', value, savedAt: new Date().toISOString() });
}

export async function requestPersistence() {
  if (navigator.storage?.persist) return navigator.storage.persist();
  return false;
}

export async function isPersisted() {
  if (navigator.storage?.persisted) return navigator.storage.persisted();
  return false;
}
