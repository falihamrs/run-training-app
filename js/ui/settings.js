// Settings screens: race, schedule, thresholds, zones and backup.
// The state object holds a working copy of the settings; inputs write into it as you
// type, validation re-runs on every change, and Save stores the validated copy.

import { WEEKDAYS } from '../core/dates.js';
import { climbDensity, kmEffort } from '../core/race.js';
import { addThresholdEntry, canRemoveEntry, defaultEffectiveFrom, earliestThreshold, removeThresholdEntry, thresholdForDate } from '../core/thresholds.js';
import { formatDuration, formatPace, parseDuration, parsePace } from '../core/units.js';
import { validateSettings } from '../core/validate.js';
import { COROS_PACE_ZONES, HR_GROUPS, formatHrRange, formatPaceRange, resolveZones } from '../core/zones.js';
import { clone, esc, getPath, setPath } from './util.js';

const TABS = [
  ['race', 'Race'],
  ['schedule', 'Schedule'],
  ['thresholds', 'Thresholds'],
  ['zones', 'Zones'],
  ['backup', 'Backup'],
];
const TERRAIN_LABELS = { flat: 'Flat', hills: 'Hills', incline: 'Incline (treadmill or stairs)' };
const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

function tabFor(field) {
  if (field.startsWith('schedule.')) return 'schedule';
  if (field.startsWith('thresholds')) return 'thresholds';
  if (field.startsWith('corosZones')) return 'zones';
  return 'race';
}

/**
 * storage: null (no saving possible) or an object with
 * saveSettings, exportBackup, importBackup, requestPersistence, isPersisted.
 */
export function mountSettings(root, { storage, settings, savedAt = null, today, storageProblem = null, lastExportedAt = null, onRestored = () => {} }) {
  const state = {
    settings: clone(settings),
    saved: JSON.stringify(settings),
    savedAt,
    tab: 'race',
    raw: {}, // text that could not be parsed, by field path: { text, kind }
    draft: { effectiveFrom: settings.thresholds.length ? defaultEffectiveFrom(today) : today, lthr: '', pace: '' },
    draftErrors: [],
    notice: null,
    persisted: false,
    lastExportedAt,
    pending: null, // { kind: 'import', name, data } or { kind: 'erase' }
  };

  // ---------- derived values ----------

  const dirty = () => JSON.stringify(state.settings) !== state.saved;

  function validation() {
    const r = validateSettings(state.settings, { today });
    const extra = Object.entries(state.raw).map(([field, { text, kind }]) => ({
      field,
      message: `Could not read "${text}". ${kind === 'pace' ? 'Use m:ss, for example 5:30.' : 'Use h:mm:ss, for example 4:15:00.'}`,
    }));
    return { ...r, errors: [...r.errors, ...extra] };
  }

  const entryInForce = () => thresholdForDate(state.settings.thresholds, today) ?? earliestThreshold(state.settings.thresholds);

  // ---------- small HTML helpers ----------

  function displayValue(path, kind) {
    if (state.raw[path]) return state.raw[path].text;
    const v = getPath(state.settings, path);
    if (v == null) return '';
    if (kind === 'duration') return formatDuration(v);
    if (kind === 'pace') return formatPace(v);
    return v;
  }

  function input(path, { kind = 'text', type = 'text', placeholder = '', attrs = '' } = {}) {
    return `<input data-path="${path}" data-kind="${kind}" type="${type}" value="${esc(displayValue(path, kind))}" placeholder="${esc(placeholder)}" ${attrs}>`;
  }

  function select(path, options, { kind = 'text', rerender = false, attrs = '' } = {}) {
    const current = getPath(state.settings, path);
    const cur = current == null ? '' : String(current);
    const opts = options
      .map(([v, label]) => `<option value="${esc(v)}" ${String(v) === cur ? 'selected' : ''}>${esc(label)}</option>`)
      .join('');
    return `<select data-path="${path}" data-kind="${kind}" ${rerender ? 'data-rerender="1"' : ''} ${attrs}>${opts}</select>`;
  }

  const field = (label, control, hint = '') =>
    `<label class="field"><span class="lbl">${label}</span>${control}${hint ? `<small>${hint}</small>` : ''}</label>`;

  // ---------- panels ----------

  function raceDerivedHtml() {
    const { race } = state.settings;
    if (race.mode !== 'trail' || !race.distanceKm || race.elevationGainM == null) return '';
    const effort = kmEffort(race.distanceKm, race.elevationGainM);
    const density = climbDensity(race.distanceKm, race.elevationGainM);
    return `<p><strong>${Math.round(effort)} km-effort</strong> (distance plus 1 km per 100 m climbed) · <strong>${Math.round(density)} m of climbing per km</strong></p>`;
  }

  function racePanel() {
    const trail = state.settings.race.mode === 'trail';
    return `
      <section class="card">
        <h2>Race</h2>
        <div class="grid">
          ${field('Mode', select('race.mode', [['trail', 'Trail'], ['road', 'Road']], { rerender: true }))}
          ${field('Experience', select('athlete.experience', [['new', 'New to running'], ['intermediate', 'Intermediate'], ['experienced', 'Experienced']]), 'Sets how fast volume ramps up and the peak targets.')}
          ${field('Race date', input('race.date', { type: 'date' }))}
          ${field('Distance (km)', input('race.distanceKm', { kind: 'num', type: 'number', attrs: `step="0.1" min="0" ${trail ? '' : 'list="road-distances"'}` }), trail ? 'Trail races: 10 to 45 km.' : 'Road races: 3 to 50 km. Presets: 5, 10, 21.0975, 42.195.')}
          ${trail ? field('Elevation gain (m)', input('race.elevationGainM', { kind: 'num', type: 'number', attrs: 'step="10" min="0"' }), 'Check the race website or the course GPX. Published figures often differ from a watch by 5–10%.') : ''}
          ${trail ? field('Elevation loss (m)', input('race.elevationLossM', { kind: 'num', type: 'number', placeholder: 'same as gain', attrs: 'step="10" min="0"' }), 'Fill in for point-to-point courses.') : ''}
          ${trail ? field('Technicality', select('race.technicality', [['easy', 'Easy'], ['moderate', 'Moderate'], ['technical', 'Technical']])) : ''}
          ${field('Goal time', input('race.goalTimeSec', { kind: 'duration', placeholder: 'h:mm:ss' }), 'Optional.')}
          ${field('Cut-off time', input('race.cutoffSec', { kind: 'duration', placeholder: 'h:mm:ss' }), 'Optional. Used to warn when the predicted time is close.')}
        </div>
        <datalist id="road-distances"><option value="5"><option value="10"><option value="21.0975"><option value="42.195"></datalist>
        <div id="race-derived" class="derived">${raceDerivedHtml()}</div>
      </section>`;
  }

  function schedulePanel() {
    const s = state.settings.schedule;
    const defaultStrength = state.settings.race.mode === 'trail' ? 2 : 1;
    const dayRows = WEEKDAYS.map((d) => {
      const off = s.unavailableDays.includes(d);
      return `<tr>
        <th scope="row">${DAY_NAMES[d]}${s.longRunDay === d ? ' <span class="tag">long run</span>' : ''}</th>
        <td><label class="inline"><input type="checkbox" data-day="${d}" ${off ? '' : 'checked'}> Available</label></td>
        <td>${select(`schedule.dayTerrain.${d}`, Object.entries(TERRAIN_LABELS), { attrs: off ? 'disabled' : '' })}</td>
      </tr>`;
    }).join('');
    return `
      <section class="card">
        <h2>Plan schedule</h2>
        <div class="grid">
          ${field('Start date', input('schedule.startDate', { type: 'date' }), 'Plans start on a Monday. Any other date moves back to the Monday before.')}
          ${field('Runs per week', select('schedule.runsPerWeek', [3, 4, 5, 6, 7].map((n) => [n, n]), { kind: 'int' }))}
          ${field('Long run day', select('schedule.longRunDay', WEEKDAYS.map((d) => [d, DAY_NAMES[d]])), 'Sunday first; Saturday also works. You can move a workout later by hand in Coros.')}
          ${field('Strength sessions per week', select('schedule.strengthSessions', [['', `Default (${defaultStrength})`], [0, '0'], [1, '1'], [2, '2']], { kind: 'intOrNull' }), 'Gym sessions of 20–30 minutes.')}
        </div>
      </section>
      <section class="card">
        <h2>Days and terrain</h2>
        <p class="muted">Mark the days you cannot run, and what is available on each day. Long runs and climbing work are placed on hills days; on flat days with no hills, climbing comes from incline sessions.</p>
        <table class="days"><tbody>${dayRows}</tbody></table>
      </section>`;
  }

  function thresholdsPanel() {
    const list = state.settings.thresholds;
    const rows = list.length
      ? list.map((e) => `<tr>
          <td>${esc(e.effectiveFrom)}${thresholdForDate(list, today)?.effectiveFrom === e.effectiveFrom ? ' <span class="tag">in force today</span>' : ''}</td>
          <td>${e.lthr ?? '–'}</td><td>${e.paceSecPerKm != null ? formatPace(e.paceSecPerKm) : '–'}</td><td>${esc(e.source)}</td>
          <td>${canRemoveEntry(e, today) ? `<button type="button" class="link" data-remove="${esc(e.effectiveFrom)}">Remove</button>` : ''}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="muted">No entries yet. Add your first entry below.</td></tr>';
    const trail = state.settings.race.mode === 'trail';
    return `
      <section class="card">
        <h2>Threshold history</h2>
        <p class="muted">Each entry applies from its date. Workouts use the entry in force on their date, so a new entry changes only future workouts. ${trail ? 'Trail mode requires an LTHR; threshold pace is optional (used on flat segments).' : 'Road mode requires a threshold pace; LTHR is optional.'}</p>
        <table class="list"><thead><tr><th>Effective from</th><th>LTHR (bpm)</th><th>Threshold pace (/km)</th><th>Source</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      </section>
      <section class="card">
        <h2>Add an entry</h2>
        <div class="grid">
          <label class="field"><span class="lbl">Effective from</span><input type="date" data-draft="effectiveFrom" value="${esc(state.draft.effectiveFrom)}"></label>
          <label class="field"><span class="lbl">LTHR (bpm)</span><input type="number" min="120" max="200" data-draft="lthr" value="${esc(state.draft.lthr)}"></label>
          <label class="field"><span class="lbl">Threshold pace (m:ss per km)</span><input type="text" placeholder="5:30" data-draft="pace" value="${esc(state.draft.pace)}"></label>
        </div>
        ${state.draftErrors.length ? `<ul class="errs">${state.draftErrors.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
        <p><button type="button" class="primary" data-action="add-threshold">Add entry</button></p>
      </section>`;
  }

  function zonesTableHtml() {
    const s = state.settings;
    const entry = entryInForce();
    if (!entry) return '<p class="muted">Add a threshold entry to see your zones.</p>';
    const zones = resolveZones({ mode: s.race.mode, lthr: entry.lthr, paceSecPerKm: entry.paceSecPerKm, coros: s.corosZones });
    const trail = s.race.mode === 'trail';
    const badge = (src) => (src === 'coros' ? '<span class="tag coros">Coros</span>' : '');
    const rows = zones
      .map((z) => `<tr><th scope="row">${z.id}</th><td>${esc(z.name)}</td>${trail ? `<td>${z.rpe}</td>` : ''}
        <td>${formatHrRange(z.hr)} ${badge(z.hrSource)}</td><td>${formatPaceRange(z.pace)} ${badge(z.paceSource)}</td></tr>`)
      .join('');
    return `
      <p class="muted">Based on the entry from ${esc(entry.effectiveFrom)}: LTHR ${entry.lthr ?? '–'} bpm, threshold pace ${entry.paceSecPerKm != null ? formatPace(entry.paceSecPerKm) + ' /km' : '–'}.</p>
      <table class="list"><thead><tr><th>Zone</th><th>Name</th>${trail ? '<th>RPE</th>' : ''}<th>Heart rate</th><th>${trail ? 'Pace (flat segments only)' : 'Pace'}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function corosEditorHtml() {
    const c = state.settings.corosZones;
    if (!c.enabled) return '';
    const hrRows = HR_GROUPS.map((g) => `<tr><th scope="row">${g}</th>
      <td>${g === 'Z1' ? '<span class="muted">no lower bound</span>' : input(`corosZones.hr.${g}.0`, { kind: 'num', type: 'number', attrs: 'min="30" max="230"' })}</td>
      <td>${g === 'Z5' ? '<span class="muted">no upper bound</span>' : input(`corosZones.hr.${g}.1`, { kind: 'num', type: 'number', attrs: 'min="30" max="230"' })}</td></tr>`).join('');
    const paceRows = COROS_PACE_ZONES.map((g) => `<tr><th scope="row">${g}</th>
      <td>${input(`corosZones.pace.${g}.0`, { kind: 'pace', placeholder: 'm:ss' })}</td>
      <td>${g === 'Z1' ? '<span class="muted">no limit</span>' : input(`corosZones.pace.${g}.1`, { kind: 'pace', placeholder: 'm:ss' })}</td></tr>`).join('');
    return `
      <div class="two">
        <div><h3>Heart rate (bpm)</h3><table class="list"><thead><tr><th>Zone</th><th>From</th><th>To</th></tr></thead><tbody>${hrRows}</tbody></table></div>
        <div><h3>Pace (per km), optional</h3><table class="list"><thead><tr><th>Zone</th><th>Faster limit</th><th>Slower limit</th></tr></thead><tbody>${paceRows}</tbody></table>
          <p class="muted">Enter Z1–Z4 completely or leave all empty. Z1 is "slower than" its faster limit. Z5 sub-zones (road) always come from threshold pace.</p></div>
      </div>
      <p><button type="button" data-action="coros-fill">Fill from the percentage table</button></p>`;
  }

  function zonesPanel() {
    const c = state.settings.corosZones;
    return `
      <section class="card">
        <h2>Zones in force</h2>
        <div id="zones-preview">${zonesTableHtml()}</div>
      </section>
      <section class="card">
        <h2>Coros zones</h2>
        <p class="muted">Zones from your Coros app take priority over the percentage table. The app cannot read them from Coros, so type them in and update them after a threshold change.</p>
        <label class="inline"><input type="checkbox" data-path="corosZones.enabled" data-kind="bool" data-rerender="1" ${c.enabled ? 'checked' : ''}> Use my Coros zones</label>
        <div id="coros-editor">${corosEditorHtml()}</div>
      </section>`;
  }

  function backupPanel() {
    const n = state.notice;
    return `
      <section class="card">
        <h2>Backup and restore</h2>
        <p class="muted">Your data lives only in this browser. Clearing browser data or switching browsers would erase it, so export a backup now and then. Backups include saved settings (not unsaved edits), plans and run summaries.</p>
        <p><button type="button" data-action="export" ${storage ? '' : 'disabled'}>Export backup</button>
          <span class="muted small">${state.lastExportedAt ? `Last export: ${esc(String(state.lastExportedAt).slice(0, 10))}` : 'No export yet.'}</span></p>
        <label class="field"><span class="lbl">Restore from a backup file</span><input type="file" accept="application/json,.json" data-import="1" ${storage ? '' : 'disabled'}></label>
        <p class="muted">Restoring replaces the saved settings, plans and runs. Uploaded activity streams are not part of a backup; the run summaries are.</p>
        ${state.pending?.kind === 'import' ? `<p class="notice warn">Replace everything in this browser with <strong>${esc(state.pending.name)}</strong>? <button type="button" class="primary" data-action="import-confirm">Yes, restore</button> <button type="button" data-action="pending-cancel">Cancel</button></p>` : ''}
      </section>
      <section class="card">
        <h2>Erase everything</h2>
        <p class="muted">Deletes settings, plans, runs and streams from this browser. Export a backup first if you might need them.</p>
        ${state.pending?.kind === 'erase' ? '<p class="notice warn">This cannot be undone. <button type="button" class="primary" data-action="erase-confirm">Yes, erase everything</button> <button type="button" data-action="pending-cancel">Cancel</button></p>' : `<p><button type="button" data-action="erase" ${storage ? '' : 'disabled'}>Erase everything</button></p>`}
      </section>
      <section class="card">
        <h2>Persistent storage</h2>
        <p>${state.persisted ? 'The browser has agreed to keep this data unless you clear it yourself.' : 'The browser may delete this data when disk space is low unless you ask it to keep it.'}</p>
        <p><button type="button" data-action="persist" ${storage && !state.persisted ? '' : 'disabled'}>Keep my data</button></p>
        <div id="notice" aria-live="polite">${n ? `<p class="notice ${n.kind}">${esc(n.text)}</p>` : ''}</div>
      </section>`;
  }

  const PANELS = { race: racePanel, schedule: schedulePanel, thresholds: thresholdsPanel, zones: zonesPanel, backup: backupPanel };

  // ---------- rendering ----------

  function render() {
    const tabs = TABS.map(([id, label]) => `<button type="button" role="tab" class="tab" aria-selected="${id === state.tab}" data-tab="${id}">${label}</button>`).join('');
    root.innerHTML = `
      ${storageProblem ? `<p class="notice error">${esc(storageProblem)}</p>` : ''}
      <nav class="tabs" role="tablist">${tabs}</nav>
      <div class="layout">
        <main class="panel" role="tabpanel">${PANELS[state.tab]()}</main>
        <aside class="side" id="messages" aria-live="polite"></aside>
      </div>
      <footer class="savebar" id="savebar"></footer>`;
    renderSide();
  }

  function renderSide() {
    const v = validation();
    const item = (kind, m) => `<li class="${kind}"><button type="button" class="link" data-goto="${tabFor(m.field)}">${tabFor(m.field)}</button> ${esc(m.message)}</li>`;
    const items = [...v.errors.map((m) => item('err', m)), ...v.warnings.map((m) => item('warn', m))];
    const msgEl = root.querySelector('#messages');
    if (msgEl) {
      msgEl.innerHTML = `<h2>Checks</h2>${items.length ? `<ul class="checks">${items.join('')}</ul>` : '<p class="ok">All settings look valid.</p>'}
        <p class="muted small">Errors block saving. Warnings are shown but allowed.</p>`;
    }
    const bar = root.querySelector('#savebar');
    if (bar) {
      const d = dirty();
      const status = !storage ? 'Saving is not available in this browser.' : d ? 'Unsaved changes' : state.savedAt ? `Saved ${new Date(state.savedAt).toLocaleString()}` : 'Nothing saved yet';
      bar.innerHTML = `<span>${esc(status)}${v.errors.length ? ` · <strong>${v.errors.length} error${v.errors.length === 1 ? '' : 's'}</strong> to fix` : ''}</span>
        <button type="button" class="primary" data-action="save" ${storage && d && v.errors.length === 0 ? '' : 'disabled'}>Save settings</button>`;
    }
    const derived = root.querySelector('#race-derived');
    if (derived) derived.innerHTML = raceDerivedHtml();
    const zones = root.querySelector('#zones-preview');
    if (zones) zones.innerHTML = zonesTableHtml();
  }

  // ---------- events ----------

  function readValue(el) {
    const kind = el.dataset.kind;
    if (kind === 'bool') return el.checked;
    const raw = el.value.trim();
    if (kind === 'num') return raw === '' || Number.isNaN(Number(raw)) ? null : Number(raw);
    if (kind === 'int') return Number.parseInt(raw, 10);
    if (kind === 'intOrNull') return raw === '' ? null : Number.parseInt(raw, 10);
    if (kind === 'duration' || kind === 'pace') {
      if (raw === '') return null;
      return kind === 'duration' ? parseDuration(raw) : parsePace(raw);
    }
    return raw === '' ? null : raw;
  }

  function onField(e) {
    const el = e.target;
    if (el.dataset.day) {
      if (e.type !== 'change') return;
      const list = new Set(state.settings.schedule.unavailableDays);
      if (el.checked) list.delete(el.dataset.day);
      else list.add(el.dataset.day);
      state.settings.schedule.unavailableDays = WEEKDAYS.filter((d) => list.has(d));
      render();
      return;
    }
    if (el.dataset.draft) {
      state.draft[el.dataset.draft] = el.value;
      return;
    }
    const path = el.dataset.path;
    if (!path) return;
    const kind = el.dataset.kind;
    const value = readValue(el);
    if ((kind === 'duration' || kind === 'pace') && value == null && el.value.trim() !== '') {
      state.raw[path] = { text: el.value.trim(), kind };
    } else {
      delete state.raw[path];
    }
    setPath(state.settings, path, value);
    if (path === 'race.mode' && state.settings.race.mode === 'trail' && state.settings.race.elevationGainM == null) {
      state.settings.race.elevationGainM = 0;
    }
    if (el.dataset.rerender && e.type === 'change') render();
    else renderSide();
  }

  async function onClick(e) {
    const el = e.target.closest('[data-tab],[data-goto],[data-action],[data-remove]');
    if (!el) return;
    if (el.dataset.tab || el.dataset.goto) {
      state.tab = el.dataset.tab || el.dataset.goto;
      render();
      return;
    }
    if (el.dataset.remove) {
      state.settings.thresholds = removeThresholdEntry(state.settings.thresholds, el.dataset.remove, today);
      render();
      return;
    }
    const action = el.dataset.action;
    if (action === 'add-threshold') addThreshold();
    else if (action === 'coros-fill') fillCoros();
    else if (action === 'save') await save();
    else if (action === 'export') await exportFile();
    else if (action === 'persist') await persist();
    else if (action === 'import-confirm') await confirmImport();
    else if (action === 'erase') { state.pending = { kind: 'erase' }; state.notice = null; render(); }
    else if (action === 'erase-confirm') await confirmErase();
    else if (action === 'pending-cancel') { state.pending = null; render(); }
  }

  function addThreshold() {
    const lthrText = String(state.draft.lthr).trim();
    const paceText = String(state.draft.pace).trim();
    const errors = [];
    const lthr = lthrText === '' ? null : Number(lthrText);
    const paceSecPerKm = paceText === '' ? null : parsePace(paceText);
    if (paceText !== '' && paceSecPerKm == null) errors.push('Threshold pace must look like 5:30.');
    if (lthr != null && Number.isNaN(lthr)) errors.push('LTHR must be a number.');
    if (errors.length === 0) {
      const r = addThresholdEntry(state.settings.thresholds, { effectiveFrom: state.draft.effectiveFrom, lthr, paceSecPerKm, source: state.draft.source || 'manual' }, today);
      errors.push(...r.errors);
      if (r.errors.length === 0) state.settings.thresholds = r.list;
    }
    state.draftErrors = errors;
    if (errors.length === 0) state.draft = { effectiveFrom: defaultEffectiveFrom(today), lthr: '', pace: '', source: 'manual' };
    render();
  }

  function fillCoros() {
    const entry = entryInForce();
    if (!entry) return;
    const c = state.settings.corosZones;
    if (entry.lthr != null) {
      const hr = resolveZones({ mode: 'trail', lthr: entry.lthr, paceSecPerKm: null });
      for (const z of hr) c.hr[z.id] = [z.hr.lo, z.hr.hi];
    }
    if (entry.paceSecPerKm != null) {
      const road = resolveZones({ mode: 'road', lthr: null, paceSecPerKm: entry.paceSecPerKm });
      for (const g of COROS_PACE_ZONES) {
        const z = road.find((r) => r.id === g);
        c.pace[g] = [z.pace.fast, z.pace.slow];
      }
    }
    for (const k of Object.keys(state.raw)) if (k.startsWith('corosZones.')) delete state.raw[k];
    render();
  }

  async function save() {
    const v = validation();
    if (!storage || v.errors.length > 0) return;
    try {
      state.settings = clone(v.normalized);
      state.savedAt = await storage.saveSettings(state.settings);
      state.saved = JSON.stringify(state.settings);
      state.notice = { kind: 'ok', text: 'Settings saved.' };
      if (!state.persisted) {
        state.persisted = await storage.requestPersistence();
      }
    } catch (err) {
      state.notice = { kind: 'error', text: `Could not save: ${err.message}` };
    }
    render();
  }

  async function exportFile() {
    try {
      const data = await storage.exportBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `run-training-backup-${today}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      await storage.markExported();
      state.lastExportedAt = new Date().toISOString();
      state.notice = { kind: 'ok', text: 'Backup downloaded.' };
    } catch (err) {
      state.notice = { kind: 'error', text: `Could not export: ${err.message}` };
    }
    render();
  }

  async function importFile(file) {
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('That file is too large to be a backup.');
      const data = JSON.parse(await file.text());
      await storage.validateBackup(data);
      state.pending = { kind: 'import', name: file.name, data };
      state.notice = null;
    } catch (err) {
      state.notice = { kind: 'error', text: err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message };
    }
    render();
  }

  async function confirmImport() {
    try {
      await storage.importBackup(state.pending.data);
      state.pending = null;
      try { sessionStorage.setItem('rtp-notice', 'Backup restored.'); } catch { /* ignore */ }
      onRestored();
    } catch (err) {
      state.pending = null;
      state.notice = { kind: 'error', text: `Could not restore: ${err.message}` };
      render();
    }
  }

  async function confirmErase() {
    try {
      await storage.eraseAll();
      try { sessionStorage.setItem('rtp-notice', 'Everything was erased.'); } catch { /* ignore */ }
      onRestored();
    } catch (err) {
      state.pending = null;
      state.notice = { kind: 'error', text: `Could not erase: ${err.message}` };
      render();
    }
  }

  async function persist() {
    state.persisted = await storage.requestPersistence();
    state.notice = state.persisted ? { kind: 'ok', text: 'The browser will keep your data.' } : { kind: 'error', text: 'The browser did not agree. Keep exporting backups.' };
    render();
  }

  root.addEventListener('input', onField);
  root.addEventListener('change', (e) => {
    if (e.target.dataset?.import && e.target.files?.[0]) importFile(e.target.files[0]);
    else onField(e);
  });
  root.addEventListener('click', onClick);
  window.addEventListener('beforeunload', (e) => {
    if (dirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  if (storage) storage.isPersisted().then((p) => { state.persisted = p; if (state.tab === 'backup') render(); });
  render();
  return {
    state,
    /** Open the Thresholds tab with a pre-filled draft (used by History suggestions). */
    prefillThreshold({ lthr = null, paceSecPerKm = null, effectiveFrom = null, source = 'suggested' }) {
      state.tab = 'thresholds';
      state.draft = {
        effectiveFrom: effectiveFrom ?? (state.settings.thresholds.length ? defaultEffectiveFrom(today) : today),
        source,
        lthr: lthr != null ? String(lthr) : state.draft.lthr,
        pace: paceSecPerKm != null ? formatPace(paceSecPerKm) : state.draft.pace,
      };
      state.draftErrors = [];
      render();
    },
    currentSettings: () => clone(state.settings),
    isDirty: dirty,
    openTab(tab) { state.tab = tab; render(); },
  };
}
