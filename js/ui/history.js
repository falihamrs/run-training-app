// History screen: upload TCX/GPX files, review runs, see the summary and threshold suggestions.
import { parseActivityFile } from '../core/tcx.js';
import { analyzeActivity } from '../core/analyze.js';
import { analyzeHistory } from '../core/history.js';
import { formatDuration, formatPace, parsePace } from '../core/units.js';
import { prescribedSnapshot } from '../core/targets.js';
import { runsByWorkout, suggestMatch } from '../core/tracking.js';
import { activityTzOffsetMin, diffDays } from '../core/dates.js';
import { formatBytes, integrityReport, runsInRange } from '../core/housekeeping.js';
import { esc } from './util.js';

const fmtKm = (v) => (v == null ? '–' : v.toFixed(1));
const CONF = { high: 'High', medium: 'Medium', low: 'Low' };

export function mountHistory(el, { storage, getSettings, today, tzOffsetMin = null, onUseThreshold, getPlan = () => null, getContext = () => null, onMatchChange = () => {} }) {
  const state = { runs: [], selfReport: null, results: [], busy: false, acceptOther: false, error: null, hk: { from: '', to: '', keepRaces: true, confirm: false, report: null, usage: null, notice: null } };

  async function reload() {
    if (!storage) return;
    state.runs = await storage.listRuns();
    state.selfReport = await storage.loadSelfReport();
  }

  function matchOptions(r) {
    const plan = getPlan();
    if (!plan) return '';
    const used = new Map([...runsByWorkout(state.runs)].map(([k, v]) => [k, v.id]));
    const opts = plan.weeks.flatMap((w) => w.workouts).filter((w) => w.role !== 'S' && Math.abs(diffDays(w.date, r.date)) <= 3)
      .map((w) => `<option value="${esc(w.id)}" ${r.matchedWorkoutId === w.id ? 'selected' : ''}>${esc(w.date.slice(5))} ${esc(w.code)}${used.has(w.id) && used.get(w.id) !== r.id ? ' (taken)' : ''}</option>`).join('');
    return `<select data-match="${r.id}" aria-label="Planned workout"><option value="">not matched</option>${opts}</select>`;
  }

  function summary(opts = {}) {
    const s = getSettings();
    const lthr = [...(s.thresholds || [])].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)).find((t) => t.lthr)?.lthr ?? null;
    return analyzeHistory(state.runs, { planStart: opts.planStart ?? s.schedule.startDate, asOf: today, lthr, selfReport: state.selfReport, mode: s.race.mode, tzOffsetMin: tzOffsetMin ?? -new Date().getTimezoneOffset() });
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
      <td>${formatPace(r.avgPaceSecPerKm)}</td><td>${r.avgHr ? Math.round(r.avgHr) : '–'}</td><td>${Math.round(r.gainM)}</td><td>${esc(r.terrain)}</td>${getPlan() ? `<td>${matchOptions(r)}</td>` : ''}
      <td><label class="inline"><input type="checkbox" data-race="${r.id}" ${r.race ? 'checked' : ''}> race</label></td>
      <td><button type="button" class="link" data-del="${r.id}">Delete</button></td></tr>`).join('');
    return `<section class="card"><h2>Activities (${state.runs.length})</h2>
      <div class="scroll"><table class="list"><thead><tr><th>Date</th><th>km</th><th>Time</th><th>Pace</th><th>HR</th><th>Climb m</th><th>Terrain</th>${getPlan() ? '<th>Planned workout</th>' : ''}<th></th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }

  function housekeepingCard() {
    if (!storage) return '';
    const hk = state.hk;
    const u = hk.usage;
    const matching = runsInRange(state.runs, hk.from, hk.to, { keepRaces: hk.keepRaces });
    const usageLine = u
      ? `${u.runs} run${u.runs === 1 ? '' : 's'} and ${u.streams} detailed run record${u.streams === 1 ? '' : 's'}, about ${formatBytes(u.runBytes + u.streamBytes + u.planBytes)} of your data${u.usage != null && u.quota ? `. The browser reports ${formatBytes(u.usage)} used of ${formatBytes(u.quota)} available for this site` : ''}.`
      : 'Checking…';
    const rep = hk.report;
    const repHtml = rep ? (rep.fixable || rep.missingStreams.length
      ? `<p class="notice warn">${rep.orphanStreams.length} leftover run record${rep.orphanStreams.length === 1 ? '' : 's'}, ${rep.danglingMatches.length} run${rep.danglingMatches.length === 1 ? '' : 's'} linked to a workout that no longer exists${rep.missingStreams.length ? `, ${rep.missingStreams.length} run${rep.missingStreams.length === 1 ? '' : 's'} without detailed data (fine, nothing to fix)` : ''}.
        ${rep.fixable ? '<button type="button" class="primary" data-hk="fix">Clean up</button>' : ''}</p>`
      : '<p class="notice ok">Everything is consistent. Nothing to clean up.</p>') : '';
    return `<section class="card"><h2>Housekeeping</h2>
      <p class="muted">${usageLine}</p>
      ${hk.notice ? `<p class="notice ${hk.notice.kind === 'error' ? 'error' : 'ok'}">${esc(hk.notice.text)}</p>` : ''}
      <h3>Delete old runs</h3>
      <div class="grid">
        <label class="field"><span class="lbl">From date</span><input type="date" data-hk-field="from" value="${esc(hk.from)}"></label>
        <label class="field"><span class="lbl">To date</span><input type="date" data-hk-field="to" value="${esc(hk.to)}"></label>
      </div>
      <label class="inline"><input type="checkbox" data-hk-field="keepRaces" ${hk.keepRaces ? 'checked' : ''}> Keep runs marked as race</label>
      <p class="muted">${hk.from || hk.to ? `${matching.length} run${matching.length === 1 ? '' : 's'} in this range.` : 'Pick a start date, an end date, or both.'} Deleting runs changes your history summary and threshold suggestions.</p>
      ${hk.confirm && matching.length
        ? `<p class="notice warn">Delete ${matching.length} run${matching.length === 1 ? '' : 's'} for good? <button type="button" class="primary" data-hk="delete-confirm">Yes, delete</button> <button type="button" data-hk="cancel">Cancel</button></p>`
        : `<p><button type="button" data-hk="delete" ${matching.length ? '' : 'disabled'}>Delete these runs</button></p>`}
      <h3>Check stored data</h3>
      <p><button type="button" data-hk="check">Check and find leftovers</button></p>
      ${repHtml}
    </section>`;
  }

  async function refreshUsage() {
    if (!storage?.storageUsage) return;
    try { state.hk.usage = await storage.storageUsage(); } catch { state.hk.usage = null; }
  }

  function render() {
    const h = summary();
    el.innerHTML = `${storage ? '' : '<p class="notice error">Storage is not available, so uploaded runs cannot be kept.</p>'}
      ${state.error ? `<p class="notice error">${esc(state.error)}</p>` : ''}
      ${uploadCard()}${summaryCard(h)}${suggestionCard(h)}${state.runs.length ? '' : selfReportCard()}${runsCard()}${housekeepingCard()}`;
    el._summary = h;
  }

  async function importFiles(files) {
    state.busy = true;
    state.results = [];
    render();
    await reload();
    const taken = new Set(runsByWorkout(state.runs).keys());
    for (const file of files) {
      try {
        if (file.size > 30 * 1024 * 1024) throw new Error('This file is too large to be a run (over 30 MB).');
        const acts = parseActivityFile(await file.text(), file.name);
        let added = 0, skipped = 0, matched = 0, rejected = [];
        for (const act of acts) {
          const sport = String(act.sport).toLowerCase();
          const isRun = /run|trail/.test(sport) || (state.acceptOther && (sport === 'other' || sport === 'unknown'));
          if (!isRun) { rejected.push(`sport "${act.sport}"`); continue; }
          act.sport = 'Running';
          // the offset in force when the run happened (daylight saving), or the run's own zone if recorded far away
          const lon = act.points?.find((pt) => pt.lon != null)?.lon ?? null;
          const tz = tzOffsetMin ?? activityTzOffsetMin(-new Date(act.startTime).getTimezoneOffset(), lon);
          const r = analyzeActivity(act, { tzOffsetMin: tz, fileName: file.name });
          if (!r.ok) { rejected.push(r.error); continue; }
          const res = await storage.addRun(r.run, r.stream);
          if (res.added) {
            added++;
            const plan = getPlan();
            const wid = plan ? suggestMatch(plan, r.run, taken) : null;
            if (wid) {
              const workout = plan.weeks.flatMap((w) => w.workouts).find((w) => w.id === wid);
              taken.add(wid);
              await storage.updateRun(res.id, { matchedWorkoutId: wid, prescribedSnapshot: prescribedSnapshot(workout, getContext()) });
              matched++;
            }
          } else skipped++;
        }
        const parts = [];
        if (added) parts.push(`${added} run${added > 1 ? 's' : ''} added`);
        if (matched) parts.push(`${matched} matched to the plan`);
        if (skipped) parts.push('already in your history');
        if (rejected.length) parts.push(`skipped (${rejected.join(', ')})`);
        state.results.push({ name: file.name, ok: added > 0 || skipped > 0, message: parts.join('; ') || (acts.length ? 'nothing to add' : 'no activity found in this file. It may be cut off or have no track points; export it again.') });
      } catch (err) {
        state.results.push({ name: file.name, ok: false, message: err.message });
      }
    }
    state.busy = false;
    await reload();
    await refreshUsage();
    render();
  }

  el.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'hist-files' && t.files?.length) return importFiles([...t.files]);
    if (t.dataset.opt === 'acceptOther') { state.acceptOther = t.checked; return; }
    if (t.dataset.hkField) {
      const k = t.dataset.hkField;
      state.hk[k] = k === 'keepRaces' ? t.checked : t.value;
      state.hk.confirm = false;
      state.hk.notice = null;
      return render();
    }
    if (t.dataset.match !== undefined) {
      const id = Number(t.dataset.match);
      const wid = t.value || null;
      const plan = getPlan();
      for (const other of state.runs) if (wid && other.matchedWorkoutId === wid && other.id !== id) await storage.updateRun(other.id, { matchedWorkoutId: null, prescribedSnapshot: null });
      const workout = wid ? plan.weeks.flatMap((w) => w.workouts).find((w) => w.id === wid) : null;
      await storage.updateRun(id, { matchedWorkoutId: wid, prescribedSnapshot: workout ? prescribedSnapshot(workout, getContext()) : null });
      await reload(); render(); onMatchChange();
      return;
    }
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
    const b = e.target.closest('[data-del],[data-act],[data-hk]');
    if (!b) return;
    if (b.dataset.hk) {
      const hk = state.hk;
      if (b.dataset.hk === 'delete') { hk.confirm = true; hk.notice = null; return render(); }
      if (b.dataset.hk === 'cancel') { hk.confirm = false; return render(); }
      if (b.dataset.hk === 'delete-confirm') {
        const ids = runsInRange(state.runs, hk.from, hk.to, { keepRaces: hk.keepRaces }).map((r) => r.id);
        await storage.deleteRuns(ids);
        hk.confirm = false;
        hk.notice = { kind: 'ok', text: `${ids.length} run${ids.length === 1 ? '' : 's'} deleted.` };
        hk.report = null;
        await reload(); await refreshUsage(); render(); onMatchChange();
        return;
      }
      if (b.dataset.hk === 'check' || b.dataset.hk === 'fix') {
        const streamIds = await storage.listStreamIds();
        let rep = integrityReport({ runs: state.runs, streamIds, plan: getPlan() });
        if (b.dataset.hk === 'fix') {
          if (rep.orphanStreams.length) await storage.deleteStreams(rep.orphanStreams);
          for (const id of rep.danglingMatches) await storage.updateRun(id, { matchedWorkoutId: null });
          hk.notice = { kind: 'ok', text: `Cleaned up ${rep.fixable} item${rep.fixable === 1 ? '' : 's'}.` };
          await reload();
          rep = integrityReport({ runs: state.runs, streamIds: await storage.listStreamIds(), plan: getPlan() });
          onMatchChange();
        } else hk.notice = null;
        hk.report = rep;
        await refreshUsage();
        render();
        return;
      }
      return;
    }
    if (b.dataset.del) {
      await storage.deleteRun(Number(b.dataset.del));
      await reload();
      await refreshUsage();
      render();
    } else if (b.dataset.act === 'use-threshold') {
      const h = el._summary;
      onUseThreshold?.({ lthr: h.suggestions.lthr.value, paceSecPerKm: h.suggestions.thresholdPaceSecPerKm.value });
    }
  });

  return { refresh: async () => { await reload(); await refreshUsage(); render(); }, getSummary: async (opts) => { await reload(); return summary(opts); }, getRuns: () => state.runs };
}
