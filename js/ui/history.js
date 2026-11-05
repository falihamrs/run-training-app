// History screen: upload TCX/GPX files, review runs, see the summary and threshold suggestions.
import { parseActivityFile } from '../core/tcx.js';
import { analyzeActivity } from '../core/analyze.js';
import { analyzeHistory } from '../core/history.js';
import { formatDuration, formatPace, parsePace } from '../core/units.js';
import { esc } from './util.js';

const fmtKm = (v) => (v == null ? '–' : v.toFixed(1));
const CONF = { high: 'High', medium: 'Medium', low: 'Low' };

export function mountHistory(el, { storage, getSettings, today, tzOffsetMin = -new Date().getTimezoneOffset(), onUseThreshold }) {
  const state = { runs: [], selfReport: null, results: [], busy: false, acceptOther: false, error: null };

  async function reload() {
    if (!storage) return;
    state.runs = await storage.listRuns();
    state.selfReport = await storage.loadSelfReport();
  }

  function summary() {
    const s = getSettings();
    const lthr = [...(s.thresholds || [])].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)).find((t) => t.lthr)?.lthr ?? null;
    return analyzeHistory(state.runs, { planStart: s.schedule.startDate, asOf: today, lthr, selfReport: state.selfReport, mode: s.race.mode, tzOffsetMin });
  }

  function uploadCard() {
    const rows = state.results.map((r) => `<li class="${r.ok ? 'ok' : 'bad'}">${esc(r.name)}: ${esc(r.message)}</li>`).join('');
    return `<section class="card"><h2>Add activities</h2>
      <p class="muted">Choose one or many .tcx or .gpx files exported from Strava or Coros. Files are read in your browser and never uploaded anywhere.</p>
      <p><input type="file" id="hist-files" multiple accept=".tcx,.gpx,.xml" ${state.busy || !storage ? 'disabled' : ''}></p>
      <label class="inline"><input type="checkbox" data-opt="acceptOther" ${state.acceptOther ? 'checked' : ''}> Also accept activities labelled Other or with no sport (trail runs are sometimes exported that way)</label>
      ${state.busy ? '<p class="muted">Reading files…</p>' : ''}
      ${rows ? `<ul class="results">${rows}</ul>` : ''}
    </section>`;
  }

  function selfReportCard() {
    const r = state.selfReport || {};
    return `<section class="card"><h2>No files? Tell me what you run now</h2>
      <p class="muted">Used only when there are no uploaded runs. The plan starts at 80 % of what you enter.</p>
      <div class="grid">
        <label class="field"><span class="lbl">Weekly distance (km)</span><input type="number" min="0" step="1" data-sr="weeklyKm" value="${esc(r.weeklyKm ?? '')}"></label>
        <label class="field"><span class="lbl">Runs per week</span><input type="number" min="0" max="7" data-sr="runsPerWeek" value="${esc(r.runsPerWeek ?? '')}"></label>
        <label class="field"><span class="lbl">Longest recent run (km)</span><input type="number" min="0" step="0.5" data-sr="longestRunKm" value="${esc(r.longestRunKm ?? '')}"></label>
        <label class="field"><span class="lbl">Easy pace (m:ss per km)</span><input type="text" placeholder="6:30" data-sr="easyPace" value="${esc(r.easyPaceSecPerKm != null ? formatPace(r.easyPaceSecPerKm) : '')}"></label>
      </div></section>`;
  }

  function summaryCard(h) {
    if (!h.runCount && h.source !== 'self-report') {
      return `<section class="card"><h2>Summary</h2><p class="muted">${esc(h.notes[0] || 'No runs yet.')}</p></section>`;
    }
    const trail = getSettings().race.mode === 'trail';
    const stat = (label, value) => `<div class="stat"><div class="lbl">${label}</div><div>${value}</div></div>`;
    const weekRows = h.weekly.map((w) => `<tr><td>${esc(w.start)}</td><td>${w.runs}</td><td>${w.km.toFixed(1)}</td><td>${w.hours.toFixed(1)}</td><td>${Math.round(w.vertM)}</td></tr>`).join('');
    return `<section class="card"><h2>Summary${h.source === 'self-report' ? ' (from your own numbers)' : ''}</h2>
      <div class="stats">
        ${stat('Weekly distance', `${fmtKm(h.baselineWeeklyKm)} km`)}
        ${h.source === 'files' ? stat('Weekly time', `${h.baselineWeeklyHours.toFixed(1)} h`) : ''}
        ${h.source === 'files' ? stat('Weekly climbing', `${Math.round(h.baselineWeeklyVertM)} m`) : ''}
        ${stat('Runs per week', h.runsPerWeek || '–')}
        ${stat('Longest run', h.longestRunKm ? `${fmtKm(h.longestRunKm)} km` : '–')}
        ${stat('Easy pace', h.easyPaceSecPerKm ? `${formatPace(h.easyPaceSecPerKm)} /km` : '–')}
        ${trail && h.trailPaceMinPerKmEffort ? stat('Trail pace', `${h.trailPaceMinPerKmEffort.toFixed(1)} min per effort-km`) : ''}
        ${trail && h.climbSpeedAtZ2 ? stat('Climb speed easy', `${Math.round(h.climbSpeedAtZ2)} m/h`) : ''}
        ${trail && h.climbSpeedAtZ4 ? stat('Climb speed hard', `${Math.round(h.climbSpeedAtZ4)} m/h`) : ''}
      </div>
      ${h.returnFromBreak ? '<p class="notice warn">A break was detected, so the baseline is lower than your best weeks.</p>' : ''}
      ${h.notes.filter((n) => !n.startsWith('Break')).map((n) => `<p class="muted">${esc(n)}</p>`).join('')}
      ${h.weekly.length ? `<details><summary>Weekly table (${h.windowWeeks} full weeks, Monday to Sunday)</summary>
        <table class="list"><thead><tr><th>Week of</th><th>Runs</th><th>km</th><th>Hours</th><th>Climb m</th></tr></thead><tbody>${weekRows}</tbody></table></details>` : ''}
    </section>`;
  }

  function suggestionCard(h) {
    if (h.source !== 'files') return '';
    const l = h.suggestions.lthr;
    const p = h.suggestions.thresholdPaceSecPerKm;
    const line = (label, val, s) => `<tr><td>${label}</td><td>${val}</td><td><span class="tag ${s.confidence === 'low' ? 'coros' : ''}">${CONF[s.confidence]}</span></td></tr>`;
    return `<section class="card"><h2>Threshold suggestions</h2>
      <p class="muted">Estimated from your hardest sustained efforts. Treat them as a starting point: a proper 30-minute test gives better numbers.</p>
      <table class="list"><thead><tr><th></th><th>Estimate</th><th>Confidence</th></tr></thead><tbody>
        ${line('LTHR', l.value ? `${l.value} bpm` : 'not found', l)}
        ${line('Threshold pace', p.value ? `${formatPace(p.value)} /km` : 'not found', p)}
      </tbody></table>
      ${(l.value || p.value) ? '<p><button type="button" class="primary" data-act="use-threshold">Use as a new threshold entry</button></p>' : ''}
      ${(l.confidence === 'low' || p.confidence === 'low') ? '<p class="muted">Low confidence means no clear hard effort was found. Do a 30-minute all-out-but-even run and upload it.</p>' : ''}
    </section>`;
  }

  function runsCard() {
    if (!state.runs.length) return '';
    const rows = [...state.runs].reverse().map((r) => `<tr>
      <td>${esc(r.date)}</td><td>${r.distanceKm.toFixed(1)}</td><td>${formatDuration(r.movingSec)}</td>
      <td>${formatPace(r.avgPaceSecPerKm)}</td><td>${r.avgHr ? Math.round(r.avgHr) : '–'}</td><td>${Math.round(r.gainM)}</td><td>${esc(r.terrain)}</td>
      <td><label class="inline"><input type="checkbox" data-race="${r.id}" ${r.race ? 'checked' : ''}> race</label></td>
      <td><button type="button" class="link" data-del="${r.id}">Delete</button></td></tr>`).join('');
    return `<section class="card"><h2>Activities (${state.runs.length})</h2>
      <div class="scroll"><table class="list"><thead><tr><th>Date</th><th>km</th><th>Time</th><th>Pace</th><th>HR</th><th>Climb m</th><th>Terrain</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }

  function render() {
    const h = summary();
    el.innerHTML = `${storage ? '' : '<p class="notice error">Storage is not available, so uploaded runs cannot be kept.</p>'}
      ${state.error ? `<p class="notice error">${esc(state.error)}</p>` : ''}
      ${uploadCard()}${summaryCard(h)}${suggestionCard(h)}${state.runs.length ? '' : selfReportCard()}${runsCard()}`;
    el._summary = h;
  }

  async function importFiles(files) {
    state.busy = true;
    state.results = [];
    render();
    for (const file of files) {
      try {
        const acts = parseActivityFile(await file.text(), file.name);
        let added = 0, skipped = 0, rejected = [];
        for (const act of acts) {
          const sport = String(act.sport).toLowerCase();
          const isRun = /run|trail/.test(sport) || (state.acceptOther && (sport === 'other' || sport === 'unknown'));
          if (!isRun) { rejected.push(`sport "${act.sport}"`); continue; }
          act.sport = 'Running';
          const r = analyzeActivity(act, { tzOffsetMin, fileName: file.name });
          if (!r.ok) { rejected.push(r.error); continue; }
          const res = await storage.addRun(r.run, r.stream);
          if (res.added) added++; else skipped++;
        }
        const parts = [];
        if (added) parts.push(`${added} run${added > 1 ? 's' : ''} added`);
        if (skipped) parts.push('already in your history');
        if (rejected.length) parts.push(`skipped (${rejected.join(', ')})`);
        state.results.push({ name: file.name, ok: added > 0 || skipped > 0, message: parts.join('; ') || 'nothing to add' });
      } catch (err) {
        state.results.push({ name: file.name, ok: false, message: err.message });
      }
    }
    state.busy = false;
    await reload();
    render();
  }

  el.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'hist-files' && t.files?.length) return importFiles([...t.files]);
    if (t.dataset.opt === 'acceptOther') { state.acceptOther = t.checked; return; }
    if (t.dataset.race) { await storage.updateRun(Number(t.dataset.race), { race: t.checked }); await reload(); render(); return; }
    if (t.dataset.sr) {
      const sr = { ...(state.selfReport || {}) };
      if (t.dataset.sr === 'easyPace') {
        const v = parsePace(t.value);
        sr.easyPaceSecPerKm = v ?? null;
      } else sr[t.dataset.sr] = t.value === '' ? null : Number(t.value);
      state.selfReport = sr;
      await storage.saveSelfReport(sr);
      render();
    }
  });

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del],[data-act]');
    if (!b) return;
    if (b.dataset.del) {
      await storage.deleteRun(Number(b.dataset.del));
      await reload();
      render();
    } else if (b.dataset.act === 'use-threshold') {
      const h = el._summary;
      onUseThreshold?.({ lthr: h.suggestions.lthr.value, paceSecPerKm: h.suggestions.thresholdPaceSecPerKm.value });
    }
  });

  return { refresh: async () => { await reload(); render(); } };
}
