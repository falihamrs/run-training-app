import { todayLocal } from './core/dates.js';
import { defaultSettings } from './core/defaults.js';
import { addRun, deletePlan, deleteRuns, deleteStreams, listStreamIds, storageUsage, eraseAll, loadMeta, markExported, validateBackup, deleteRun, loadPlan, loadSuggestState, savePlan, saveSuggestState, exportBackup, importBackup, isPersisted, listRuns, loadSelfReport, loadSettings, openDb, requestPersistence, saveSelfReport, saveSettings, updateRun } from './storage.js';
import { mountHistory } from './ui/history.js';
import { mountPlan } from './ui/plan.js';
import { mountSettings } from './ui/settings.js';

const root = document.getElementById('app');
const today = todayLocal();

async function start() {
  let storage = null;
  let settings = defaultSettings(today);
  let savedAt = null;
  let storageProblem = null;
  let lastExportedAt = null;

  try {
    const db = openDb();
    const loaded = await loadSettings(db, today);
    settings = loaded.settings;
    savedAt = loaded.savedAt;
    lastExportedAt = (await loadMeta(db)).lastExportedAt ?? null;
    storage = {
      saveSettings: (s) => saveSettings(db, s),
      exportBackup: () => exportBackup(db),
      importBackup: (data) => importBackup(db, data, today),
      validateBackup: (data) => validateBackup(data),
      markExported: () => markExported(db),
      eraseAll: () => eraseAll(db),
      loadMeta: () => loadMeta(db),
      requestPersistence,
      isPersisted,
      addRun: (run, stream) => addRun(db, run, stream),
      listRuns: () => listRuns(db),
      updateRun: (id, changes) => updateRun(db, id, changes),
      deleteRun: (id) => deleteRun(db, id),
      deleteRuns: (ids) => deleteRuns(db, ids),
      deleteStreams: (ids) => deleteStreams(db, ids),
      listStreamIds: () => listStreamIds(db),
      storageUsage: () => storageUsage(db),
      loadSelfReport: () => loadSelfReport(db),
      saveSelfReport: (v) => saveSelfReport(db, v),
      savePlan: (p) => savePlan(db, p),
      loadPlan: () => loadPlan(db),
      deletePlan: () => deletePlan(db),
      loadSuggestState: () => loadSuggestState(db),
      saveSuggestState: (v) => saveSuggestState(db, v),
    };
  } catch (err) {
    storageProblem = `Browser storage is not available (${err.message}). You can look around, but nothing can be saved. Private browsing mode is a common cause.`;
  }

  root.innerHTML = `<header class="top"><h1>Run Training Planner</h1>
      <nav class="pages" id="pages"><button type="button" data-page="plan">Plan</button><button type="button" data-page="history">History</button><button type="button" data-page="settings">Settings</button></nav></header>
    <div id="page-plan" hidden></div><div id="page-history" hidden></div><div id="page-settings"></div>`;
  const pageEls = { plan: root.querySelector('#page-plan'), history: root.querySelector('#page-history'), settings: root.querySelector('#page-settings') };
  let planUi = { getPlan: () => null };
  const settingsUi = mountSettings(pageEls.settings, { storage, settings, savedAt, today, storageProblem, lastExportedAt, onRestored: () => location.reload() });
  const historyUi = mountHistory(pageEls.history, {
    storage,
    getSettings: () => settingsUi.currentSettings(),
    today,
    getPlan: () => planUi.getPlan(),
    getContext: () => {
      const st = settingsUi.currentSettings();
      const pl = planUi.getPlan();
      return { thresholds: st.thresholds, coros: st.corosZones, mode: pl?.mode ?? st.race.mode, goalPaceSecPerKm: pl?.goalPaceSecPerKm ?? null };
    },
    onUseThreshold: (suggestion) => { settingsUi.prefillThreshold(suggestion); show('settings'); },
  });
  planUi = mountPlan(pageEls.plan, {
    storage,
    today,
    getSettings: () => settingsUi.currentSettings(),
    getHistory: (opts) => historyUi.getSummary(opts),
    goto: (p, tab) => { show(p); if (tab && p === 'settings') settingsUi.openTab(tab); },
    isSettingsDirty: () => settingsUi.isDirty(),
    getBackupInfo: async () => (storage ? { lastExportedAt: (await storage.loadMeta()).lastExportedAt ?? null } : null),
    onUseThreshold: (suggestion) => { settingsUi.prefillThreshold(suggestion); show('settings'); },
  });
  function show(page) {
    for (const [name, el] of Object.entries(pageEls)) el.hidden = name !== page;
    root.querySelectorAll('#pages button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.page === page)));
    if (page === 'history') historyUi.refresh();
    if (page === 'plan') planUi.refresh();
    location.hash = page;
  }
  root.querySelector('#pages').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) show(b.dataset.page);
  });
  try {
    const msg = sessionStorage.getItem('rtp-notice');
    if (msg) {
      sessionStorage.removeItem('rtp-notice');
      root.insertAdjacentHTML('afterbegin', `<p class="notice ok" role="status">${msg.replace(/[<>&]/g, '')}</p>`);
    }
  } catch { /* ignore */ }
  show(['#settings', '#history', '#plan'].includes(location.hash) ? location.hash.slice(1) : 'plan');
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

start().catch((err) => {
  root.innerHTML = `<p class="notice error">Something went wrong while starting: ${String(err.message).replace(/[<>&]/g, '')}</p>`;
  console.error(err);
});
