import { todayLocal } from './core/dates.js';
import { defaultSettings } from './core/defaults.js';
import { exportBackup, importBackup, isPersisted, loadSettings, openDb, requestPersistence, saveSettings } from './storage.js';
import { mountSettings } from './ui/settings.js';

const root = document.getElementById('app');
const today = todayLocal();

async function start() {
  let storage = null;
  let settings = defaultSettings(today);
  let savedAt = null;
  let storageProblem = null;

  try {
    const db = openDb();
    const loaded = await loadSettings(db, today);
    settings = loaded.settings;
    savedAt = loaded.savedAt;
    storage = {
      saveSettings: (s) => saveSettings(db, s),
      exportBackup: () => exportBackup(db),
      importBackup: (data) => importBackup(db, data, today),
      requestPersistence,
      isPersisted,
    };
  } catch (err) {
    storageProblem = `Browser storage is not available (${err.message}). You can look around, but nothing can be saved. Private browsing mode is a common cause.`;
  }

  mountSettings(root, { storage, settings, savedAt, today, storageProblem });
}

start().catch((err) => {
  root.innerHTML = `<p class="notice error">Something went wrong while starting: ${String(err.message).replace(/[<>&]/g, '')}</p>`;
  console.error(err);
});
