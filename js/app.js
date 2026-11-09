import { todayLocal } from './core/dates.js';
import { defaultSettings } from './core/defaults.js';
import { addRun, deletePlan, deleteRun, loadPlan, savePlan, exportBackup, importBackup, isPersisted, listRuns, loadSelfReport, loadSettings, openDb, requestPersistence, saveSelfReport, saveSettings, updateRun } from './storage.js';
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
      addRun: (run, stream) => addRun(db, run, stream),
      listRuns: () => listRuns(db),
      updateRun: (id, changes) => updateRun(db, id, changes),
      deleteRun: (id) => deleteRun(db, id),
      loadSelfReport: () => loadSelfReport(db),
      saveSelfReport: (v) => saveSelfReport(db, v),
      savePlan: (p) => savePlan(db, p),
      loadPlan: () => loadPlan(db),
      deletePlan: () => deletePlan(db),
    };
  } catch (err) {
    storageProblem = `Browser storage is not available (${err.message}). You can look around, but nothing can be saved. Private browsing mode is a common cause.`;
  }

  root.innerHTML = `<header class="top"><h1>Run Training Planner</h1>
      <nav class="pages" id="pages"><button type="button" data-page="plan">Plan</button><button type="button" data-page="history">History</button><button type="button" data-page="settings">Settings</button></nav></header>
    <div id="page-plan" hidden></div><div id="page-history" hidden></div><div id="page-settings"></div>`;
  const pageEls = { plan: root.querySelector('#page-plan'), history: root.querySelector('#page-history'), settings: root.querySelector('#page-settings') };
  const settingsUi = mountSettings(pageEls.settings, { storage, settings, savedAt, today, storageProblem });
  const historyUi = mountHistory(pageEls.history, {
    storage,
    getSettings: () => settingsUi.currentSettings(),
    today,
    onUseThreshold: (suggestion) => { settingsUi.prefillThreshold(suggestion); show('settings'); },
  });
  const planUi = mountPlan(pageEls.plan, {
    storage,
    today,
    getSettings: () => settingsUi.currentSettings(),
    getHistory: () => historyUi.getSummary(),
    goto: (p) => show(p),
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
  show(['#settings', '#history', '#plan'].includes(location.hash) ? location.hash.slice(1) : 'plan');
}

start().catch((err) => {
  root.innerHTML = `<p class="notice error">Something went wrong while starting: ${String(err.message).replace(/[<>&]/g, '')}</p>`;
  console.error(err);
});
