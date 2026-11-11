// Plan screen: generate, review and export the plan.
import { generatePlan } from '../core/plan/generate.js';
import { planCsv, stepLines, weekText, workoutText } from '../core/export.js';
import { resolveTargets } from '../core/targets.js';
import { WEEKDAYS, addDays, diffDays, nextMonday } from '../core/dates.js';
import { compareRun, planAdvice, regenerateFrom, runsByWorkout, runsToUnlink, weekProgress, workoutStatus } from '../core/tracking.js';
import { formatDuration } from '../core/units.js';
import { canInsertTest, climbTrend, goalAdvice, insertTest, nextWorkoutDate, suggestThresholdUpdate, testResultFromRun } from '../core/suggest.js';
import { earliestThreshold, thresholdForDate } from '../core/thresholds.js';
import { aiReport } from '../core/aiExport.js';
import { applyChanges, canUndo, editsLostByRegen, lockReason, undoLast } from '../core/edits.js';
import { esc } from './util.js';

const PHASE_LABEL = { base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper' };
const hm = (min) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} min`;

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function mountPlan(el, { storage, today, getSettings, getHistory, goto, onUseThreshold = () => {}, isSettingsDirty = () => false, getBackupInfo = async () => null }) {
  const state = { plan: null, messages: [], loaded: false, notice: null, confirmRegen: false, confirmNew: false, open: new Set(), runs: [], suggestState: {}, backup: null, editing: null, editMsg: null };

  const ctx = () => {
    const s = getSettings();
    return { thresholds: s.thresholds, coros: s.corosZones, mode: state.plan?.mode ?? s.race.mode, goalPaceSecPerKm: state.plan?.goalPaceSecPerKm ?? null };
  };

  function messagesHtml(list) {
    if (!list.length) return '';
    return `<ul class="checks">${list.map((m) => `<li class="${m.level === 'block' ? 'err' : m.level === 'warn' ? 'warn' : ''}">${esc(m.text)}</li>`).join('')}</ul>`;
  }

  function bannersHtml() {
    const out = [];
    if (isSettingsDirty()) out.push('<p class="notice warn">Your settings have unsaved changes. The plan uses them as shown. <button type="button" class="link" data-go="settings">Open settings</button></p>');
    const b = state.backup;
    if (b && (state.plan || state.runs.length)) {
      const days = b.lastExportedAt ? Math.floor((Date.now() - Date.parse(b.lastExportedAt)) / 86400000) : null;
      if (days == null) out.push('<p class="notice warn">You have not exported a backup yet. Your data only lives in this browser. <button type="button" class="link" data-go="settings" data-tab="backup">Export a backup</button></p>');
      else if (days >= 14) out.push(`<p class="notice warn">Your last backup is ${days} days old. <button type="button" class="link" data-go="settings" data-tab="backup">Export a new one</button></p>`);
    }
    return out.join('');
  }

  function headerCard() {
    const p = state.plan;
    if (!p) {
      return `<section class="card"><h2>Create your plan</h2>
        <p class="muted">The plan uses the race, schedule and thresholds from Settings and the baseline from History. Save your settings first.</p>
        ${messagesHtml(state.messages)}
        ${state.messages.some((m) => m.code === 'entry' && m.level === 'block') && state.messages.filter((m) => m.level === 'block').length === 1 ? '<p class="notice warn">Your recent training is below the usual starting point for this race. You can still build the plan, with a warning, if you accept the extra risk. <button type="button" data-act="generate-override">Generate anyway</button></p>' : ''}
        <p><button type="button" class="primary" data-act="generate" ${storage ? '' : 'disabled'}>Generate plan</button>
        <button type="button" class="link" data-go="settings">Open settings</button> <button type="button" class="link" data-go="history">Open history</button></p>
        ${state.runs.length ? aiExportHtml() : ''}</section>`;
    }
    const trail = p.mode === 'trail';
    const race = p.race;
    const facts = trail
      ? `${race.distanceKm} km, ${race.elevationGainM} m climbing (${race.kmEffort.toFixed(0)} km-effort). Expected duration ${hm(race.expectedDurationMin[0])} to ${hm(race.expectedDurationMin[1])}.`
      : `${race.distanceKm} km. Predicted time ${formatDuration(Math.round(race.predictedSec * 0.97))} to ${formatDuration(Math.round(race.predictedSec * 1.03))}${p.goalPaceSecPerKm ? `, goal pace ${Math.floor(p.goalPaceSecPerKm / 60)}:${String(p.goalPaceSecPerKm % 60).padStart(2, '0')}/km` : ''}.`;
    const peak = trail ? `Peak ${p.peak.hours} h and ${p.peak.vertM} m a week.` : `Peak ${p.peak.km} km a week.`;
    return `${''}<section class="card"><h2>${esc(p.mode === 'trail' ? 'Trail' : 'Road')} plan: ${esc(p.startDate)} to ${esc(p.raceDate)} <span class="tag ${p.status === 'WARN' ? 'coros' : ''}">${esc(p.status)}</span></h2>
      <p>${esc(facts)} ${esc(peak)} ${p.weeks.length} weeks.</p>
      ${messagesHtml(state.messages)}
      ${state.notice ? `<p class="notice ${state.notice.kind}">${esc(state.notice.text)}</p>` : ''}
      <p class="row">
        <button type="button" data-act="csv">Download CSV</button>
        <button type="button" data-act="copy-plan">Copy all weeks as text</button>
        ${canUndo(state.plan) ? `<button type="button" data-act="undo" title="${esc(state.plan.undo.at(-1).label)}">Undo last change</button>` : ''}
      </p>
      ${aiExportHtml()}
      <p class="row">
        ${state.confirmRegen
          ? `<span class="notice warn">Regenerate from ${esc(nextMonday(today))}? Weeks before that stay as they are.${editsLostByRegen(state.plan, nextMonday(today)) ? ` Your ${editsLostByRegen(state.plan, nextMonday(today))} edit${editsLostByRegen(state.plan, nextMonday(today)) === 1 ? '' : 's'} in those weeks will be replaced.` : ''} <button type="button" class="primary" data-act="regen-confirm">Yes, regenerate</button> <button type="button" data-act="cancel-regen">Cancel</button></span>`
          : '<button type="button" data-act="regen">Regenerate from next Monday</button>'}
        ${state.confirmNew
          ? '<span class="notice warn">Discard this plan and start a new one? Matched runs keep their record. <button type="button" class="primary" data-act="generate">Yes, start over</button> <button type="button" data-act="cancel-regen">Cancel</button></span>'
          : '<button type="button" data-act="new">Start a new plan</button>'}
      </p>
      ${adviceHtml()}</section>`;
  }

  function aiExportHtml() {
    return `<div class="row" role="group" aria-label="Export for an AI chat"><strong>For an AI chat:</strong>
      <select data-ai-range aria-label="Weeks to include"><option value="recent" ${state.aiRange === 'all' ? '' : 'selected'}>Last 4 weeks and next 4</option><option value="all" ${state.aiRange === 'all' ? 'selected' : ''}>Whole plan</option></select>
      <button type="button" data-act="ai-copy">Copy report</button> <button type="button" data-act="ai-download">Download .md</button></div>`;
  }

  async function aiText() {
    const history = getHistory ? await getHistory().catch(() => null) : null;
    return aiReport({ plan: state.plan, runs: state.runs, settings: getSettings(), today, range: state.aiRange ?? 'recent', advice: state.plan ? planAdvice(state.plan, state.runs, today) : [], history });
  }

  function adviceHtml() {
    const adv = planAdvice(state.plan, state.runs, today);
    if (!adv.length) return '';
    return adv.map((a) => `<p class="notice ${a.level === 'info' ? 'ok' : 'warn'}">${esc(a.text)}${a.action === 'regen' ? ' <button type="button" data-act="regen">Regenerate from next Monday</button>' : ''}</p>`).join('');
  }

  const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  function suggestionsHtml() {
    const p = state.plan;
    const s = getSettings();
    const parts = [];
    const sg = suggestThresholdUpdate({ runs: state.runs, thresholds: s.thresholds, today, raceDate: p.raceDate, state: state.suggestState, easyPaceSecPerKm: p.easyPaceSecPerKm, mode: p.mode });
    if (sg.kind === 'update') {
      const bits = [];
      if (sg.lthr?.proposed) bits.push(`LTHR ${sg.lthr.current} → ${sg.lthr.proposed} bpm`);
      if (sg.pace?.proposed) bits.push(`threshold pace ${clock(sg.pace.current)} → ${clock(sg.pace.proposed)} /km`);
      parts.push(`<div class="notice ok"><strong>Your fitness looks higher.</strong> ${esc(sg.evidence.join(' '))}<br>Suggested: ${esc(bits.join(', '))}. It applies from your next workout and never changes past ones.
        <button type="button" class="primary" data-sg="accept">Review and add</button> <button type="button" data-sg="dismiss">Not now (21 days)</button></div>`);
    } else if (sg.kind === 'retest') {
      parts.push(`<div class="notice warn"><strong>Retest suggested.</strong> ${esc(sg.evidence.join(' '))} Illness or fatigue is the more likely cause, so nothing is changed automatically. A 30-minute test run will tell.
        <button type="button" data-sg="dismiss">Not now (21 days)</button></div>`);
    } else if (sg.kind === 'test-needed') {
      parts.push(`<div class="notice warn"><strong>Do a 30-minute test.</strong> ${esc(sg.evidence.join(' '))} The gap is bigger than one update should move, so a test will give a reliable number. Use "Replace with 30-min test" on an upcoming quality session below.
        <button type="button" data-sg="dismiss">Not now (21 days)</button></div>`);
    }
    // finished test
    const testW = p.weeks.flatMap((w) => w.workouts).filter((w) => w.code === 'TEST');
    for (const tw of testW) {
      const run = state.runs.find((r) => r.matchedWorkoutId === tw.id);
      if (!run) continue;
      const res = testResultFromRun(run);
      const applied = s.thresholds.some((e) => e.source === 'test' && e.effectiveFrom > tw.date);
      if (!applied && (res.paceSecPerKm || res.lthr)) {
        parts.push(`<div class="notice ok"><strong>Test result (${esc(tw.date)}):</strong> ${res.paceSecPerKm ? `pace ${clock(res.paceSecPerKm)} /km` : ''}${res.paceSecPerKm && res.lthr ? ', ' : ''}${res.lthr ? `LTHR ${res.lthr} bpm` : ''}.
          <button type="button" class="primary" data-sg="use-test" data-lthr="${res.lthr ?? ''}" data-pace="${res.paceSecPerKm ?? ''}">Review and add</button></div>`);
      }
    }
    if (p.mode === 'trail') {
      const cur = thresholdForDate(s.thresholds, today) ?? earliestThreshold(s.thresholds);
      const ct = climbTrend(state.runs, cur?.lthr, today);
      if (ct?.significant) parts.push(`<p class="notice ok">Your climbing speed at threshold effort rose ${ct.pct}% over 4 weeks (${ct.beforeMh} → ${ct.recentMh} m/h).</p>`);
    } else {
      const cur = thresholdForDate(s.thresholds, today) ?? earliestThreshold(s.thresholds);
      const ga = goalAdvice({ goalTimeSec: s.race.goalTimeSec, thresholdPaceSecPerKm: cur?.paceSecPerKm, distanceKm: s.race.distanceKm });
      if (ga) parts.push(`<p class="notice ok">Your threshold now predicts ${esc(formatDuration(ga.predictedSec))}, at least 3% faster than your goal. You could set a goal near ${esc(formatDuration(ga.suggestedGoalSec))} in Settings. It is never changed automatically.</p>`);
    }
    return parts.length ? `<section class="card"><h2>Thresholds</h2>${parts.join('')}</section>` : '';
  }

  function stepsHtml(w) {
    const resolved = resolveTargets(w, ctx());
    const lines = stepLines(resolved.steps, { trail: state.plan.mode === 'trail' });
    return `<ol class="steps">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;
  }

  function workoutHtml(w, week) {
    const byWorkout = runsByWorkout(state.runs);
    const run = byWorkout.get(w.id) ?? null;
    const status = w.code === 'RACE' && !run && w.date >= today ? 'upcoming' : workoutStatus(w, run, today);
    const statusTag = { done: '<span class="tag">done</span>', missed: '<span class="tag coros">missed</span>', today: '<span class="tag">today</span>' }[status] ?? '';
    const cmp = run ? compareRun(w, run) : null;
    const actual = run ? `<p class="small ok">Done: ${run.distanceKm.toFixed(1)} km in ${Math.round(run.movingSec / 60)} min${run.gainM ? `, ${Math.round(run.gainM)} m climbing` : ''}${cmp.avgHr ? `, average HR ${cmp.avgHr}` : ''} (${cmp.minDiff >= 0 ? '+' : ''}${cmp.minDiff} min vs plan${cmp.vertDiff != null ? `, ${cmp.vertDiff >= 0 ? '+' : ''}${cmp.vertDiff} m` : ''}).${run.prescribedSnapshot?.thresholdEffectiveFrom ? ` Prescribed with the thresholds from ${esc(run.prescribedSnapshot.thresholdEffectiveFrom)}.` : ''}</p>` : '';
    const climb = w.plannedVertM ? ` · ${w.plannedVertM} m` : '';
    const km = w.plannedKm && w.code !== 'RACE' && state.plan.mode === 'road' ? ` · ~${w.plannedKm} km` : '';
    const date = new Date(w.date + 'T00:00:00Z');
    const body = w.code === 'RACE' ? '<p>Good luck. Race fuelling and gear as practised.</p>' : `${stepsHtml(w)}${(w.notes ?? []).map((n) => `<p class="muted small">${esc(n)}</p>`).join('')}`;
    return `<article class="workout role-${esc(w.role)}${w.date === today ? ' today' : ''}">
      <header><strong>${esc(w.weekday)} ${date.getUTCDate()}/${date.getUTCMonth() + 1}</strong> <span class="code">${esc(w.code)}</span> ${esc(w.name)}
        <span class="muted small">${w.plannedMin} min${km}${climb}</span> ${statusTag}
        <button type="button" class="link" data-copy-workout="${esc(w.id)}">Copy</button>
        ${canInsertTest(state.plan, w, today) ? `<button type="button" class="link" data-test="${esc(w.id)}">Replace with 30-min test</button>` : ''}
        ${editable(w) && state.editing !== w.id ? `<button type="button" class="link" data-edit="${esc(w.id)}" aria-label="Edit ${esc(w.name)} on ${esc(w.date)}">Edit</button>` : ''}
        ${w.edited ? '<span class="tag">edited</span>' : ''}</header>
      ${state.editing === w.id ? editFormHtml(w, week) : ''}
      ${state.editMsg?.id === w.id ? `<p class="notice ${state.editMsg.kind} small" role="status">${esc(state.editMsg.text)}</p>` : ''}
      ${body}${actual}</article>`;
  }

  function editable(w) {
    return !lockReason(state.plan, w.id, { today, runs: state.runs });
  }

  function editFormHtml(w, week) {
    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const days = DAYS.map((d, i) => ({ d, date: addDays(week.start, i) })).filter((x) => x.date >= today && x.date < state.plan.raceDate);
    const run = w.role !== 'S';
    return `<form class="edit" data-edit-form="${esc(w.id)}" onsubmit="return false">
      <div class="row">
        <label class="field"><span class="lbl">Day</span><select data-edit-day>${days.map((x) => `<option value="${x.d}" ${x.d === w.weekday ? 'selected' : ''}>${x.d} ${x.date.slice(8)}/${Number(x.date.slice(5, 7))}</option>`).join('')}</select></label>
        ${run ? `<label class="field"><span class="lbl">Length (min)</span><input type="number" inputmode="numeric" min="15" max="360" step="5" value="${w.plannedMin}" data-edit-min style="width:6em"></label>` : ''}
      </div>
      <p class="row"><button type="button" class="primary" data-edit-do="save">Save</button>
        ${run && w.code !== 'EZ' ? '<button type="button" data-edit-do="easy">Make it an easy run</button>' : ''}
        <button type="button" data-edit-do="rest">Rest day instead</button>
        <button type="button" data-edit-do="cancel">Cancel</button></p>
      <p class="muted small">Edits apply to this plan only. "Regenerate" rebuilds the weeks it covers, edits included.</p>
    </form>`;
  }

  function scaleHtml(week) {
    if (!week.workouts.some((w) => w.role !== 'S' && w.role !== 'RACE' && editable(w))) return '';
    return `<p class="row small"><label>Adjust this week: <select data-scale="${week.n}">
      <option value="">choose…</option><option value="0.7">30% less</option><option value="0.8">20% less</option><option value="0.9">10% less</option><option value="1.05">5% more</option><option value="1.1">10% more</option></select></label>
      <button type="button" class="link" data-scale-do="${week.n}">Apply</button></p>`;
  }

  async function commit(changes, { focus = null, label = null } = {}) {
    const warnFail = [];
    const r = applyChanges(state.plan, changes, { today, runs: state.runs, source: 'manual', label });
    const res = r.results[r.results.length - 1];
    if (!r.results.some((x) => x.ok)) {
      state.editMsg = { id: focus, kind: 'error', text: res.error };
      return render();
    }
    state.plan = r.plan;
    state.editing = null;
    const mv = changes.find((c) => c.op === 'move');
    const moved = mv && r.results.find((x) => x.change === mv)?.ok ? mv.workout.replace(/^(w\d+-)[A-Z][a-z]{2}/, `$1${mv.to}`) : null;
    if (r.results.some((x) => !x.ok)) r.results.filter((x) => !x.ok).forEach((x) => warnFail.push(x.error));
    const warn = [...warnFail, ...r.results.flatMap((x) => x.warnings ?? [])];
    state.editMsg = { id: moved ?? focus, kind: warn.length ? 'warn' : 'ok', text: warn.length ? `Saved, but note: ${warn.join(' ')}` : `Saved: ${res.summary}.` };
    if (storage) {
      try { await storage.savePlan(state.plan); } catch (err) { state.editMsg = { id: focus, kind: 'error', text: `The change could not be saved: ${err.message}` }; }
    }
    render();
  }

  function weekHtml(week) {
    const trail = state.plan.mode === 'trail';
    const target = trail ? `${week.targetHours} h · ${week.targetVertM} m` : `${week.targetKm} km`;
    const planned = trail ? `${(week.plannedMin / 60).toFixed(1)} h · ${week.plannedVertM} m` : `${week.plannedKm} km`;
    const prog = weekProgress(week, state.runs, today, state.plan.mode);
    const done = trail ? `${(prog.actualMin / 60).toFixed(1)} h · ${Math.round(prog.actualVertM)} m` : `${prog.actualKm.toFixed(1)} km`;
    const progTxt = prog.runs || prog.complete ? ` · done ${done}${prog.ratio != null ? ` (${Math.round(prog.ratio * 100)}%)` : ''}` : '';
    const isCurrent = diffDays(week.start, today) >= 0 && diffDays(week.start, today) < 7;
    const anyCurrent = state.plan.weeks.some((x) => diffDays(x.start, today) >= 0 && diffDays(x.start, today) < 7);
    const open = state.open.has(week.n) || ((isCurrent || (!anyCurrent && week.n === 1)) && !state.open.has(-week.n));
    return `<details class="week${isCurrent ? ' current' : ''}" data-week="${week.n}" ${open ? 'open' : ''}>
      <summary><strong>Week ${week.n}</strong> · ${esc(week.start)} · ${PHASE_LABEL[week.phase]}${week.kind === 'down' ? ' (down week)' : ''} · target ${target} · planned ${planned}${progTxt}${week.locked ? ' · locked' : ''}${isCurrent ? ' <span class="tag">this week</span>' : ''}</summary>
      <p class="muted small">${esc(week.reason)}</p>
      ${week.flags.map((f) => `<p class="notice warn small">${esc(f)}</p>`).join('')}
      <p><button type="button" class="link" data-copy-week="${week.n}">Copy this week as text</button></p>
      ${scaleHtml(week)}
      ${state.editMsg?.id === `week-${week.n}` ? `<p class="notice ${state.editMsg.kind} small" role="status">${esc(state.editMsg.text)}</p>` : ''}
      ${week.workouts.map((w) => workoutHtml(w, week)).join('')}
    </details>`;
  }

  function render() {
    el.innerHTML = `${bannersHtml()}${headerCard()}${state.plan ? suggestionsHtml() : ''}${state.plan ? state.plan.weeks.map(weekHtml).join('') : ''}`;
  }

  async function generate({ keepPast = false, override = false } = {}) {
    state.confirmRegen = false;
    state.confirmNew = false;
    state.notice = null;
    const settings = getSettings();
    const now = new Date().toISOString();
    let r;
    try {
    if (keepPast && state.plan) {
      const history = await getHistory({ planStart: nextMonday(today) });
      r = regenerateFrom(state.plan, settings, history, { today, now });
    } else {
      const history = await getHistory();
      r = generatePlan(settings, history, { today, id: 'main', now, overrideEntry: override || Boolean(state.plan?.entryOverridden) });
    }
    } catch (err) {
      console.error(err);
      state.messages = [{ level: 'block', code: 'error', text: `Something went wrong while building the plan: ${err.message}` }];
      render();
      return;
    }
    state.messages = r.messages;
    if (!r.plan) {
      if (state.plan) state.notice = { kind: 'error', text: `The plan could not be ${keepPast ? 'regenerated' : 'replaced'}. See the messages above; your current plan is unchanged.` };
      render();
      return;
    }
    // Workout ids are only week number and weekday, so a replaced plan would silently inherit the old
    // matches. Unlink them (the prescribed snapshot on each run stays as the record).
    if (!keepPast && storage) {
      for (const id of runsToUnlink(state.runs)) await storage.updateRun(id, { matchedWorkoutId: null });
      state.runs = await storage.listRuns();
    }
    state.plan = r.plan;
    if (storage) {
      try { await storage.savePlan(r.plan); state.notice = { kind: 'ok', text: 'Plan saved in this browser.' }; }
      catch (err) { state.notice = { kind: 'error', text: `The plan could not be saved: ${err.message}` }; }
    }
    render();
  }

  async function refresh() {
    if (!state.loaded && storage) {
      state.plan = await storage.loadPlan();
      state.loaded = true;
      if (state.plan && !state.messages.length) state.messages = state.plan.messages ?? [];
    }
    if (storage) { state.runs = await storage.listRuns(); state.suggestState = await storage.loadSuggestState(); state.backup = await getBackupInfo(); }
    render();
  }

  function findWorkout(id) {
    for (const w of state.plan.weeks) for (const x of w.workouts) if (x.id === id) return [x, w];
    return [null, null];
  }

  function keepOpen() {
    [...el.querySelectorAll('details[open]')].forEach((d) => state.open.add(Number(d.dataset.week)));
  }

  async function flash(ok, what, where = 'your notes or the Coros app') {
    state.notice = ok ? { kind: 'ok', text: `${what} copied. Paste it into ${where}.` } : { kind: 'error', text: 'Copying was blocked by the browser. Select the text manually.' };
    const keep = [...el.querySelectorAll('details[open]')].map((d) => Number(d.dataset.week));
    keep.forEach((n) => state.open.add(n));
    render();
  }

  el.addEventListener('change', (e) => {
    if (e.target.dataset?.aiRange != null) state.aiRange = e.target.value === 'all' ? 'all' : 'recent';
  });

  el.addEventListener('toggle', (e) => {
    const d = e.target.closest?.('details.week');
    if (!d) return;
    const n = Number(d.dataset.week);
    if (d.open) { state.open.add(n); state.open.delete(-n); } else { state.open.delete(n); state.open.add(-n); }
  }, true);

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act],[data-copy-workout],[data-copy-week],[data-go],[data-sg],[data-test],[data-edit],[data-edit-do],[data-scale-do]');
    if (!b) return;
    if (b.dataset.edit) { state.editing = b.dataset.edit; state.editMsg = null; keepOpen(); return render(); }
    if (b.dataset.editDo) {
      const form = b.closest('[data-edit-form]');
      const id = form.dataset.editForm;
      const w = state.plan.weeks.flatMap((x) => x.workouts).find((x) => x.id === id);
      keepOpen();
      const act = b.dataset.editDo;
      if (act === 'cancel') { state.editing = null; return render(); }
      if (act === 'easy') return commit([{ op: 'easy', workout: id, minutes: Number(form.querySelector('[data-edit-min]')?.value) || undefined }], { focus: id });
      if (act === 'rest') return commit([{ op: 'rest', workout: id }], { focus: `week-${w.week}` });
      const changes = [];
      const min = Number(form.querySelector('[data-edit-min]')?.value);
      if (w.role !== 'S' && Number.isFinite(min) && min !== w.plannedMin) changes.push({ op: 'duration', workout: id, minutes: min });
      const day = form.querySelector('[data-edit-day]')?.value;
      if (day && day !== w.weekday) changes.push({ op: 'move', workout: id, to: day });
      if (!changes.length) { state.editing = null; return render(); }
      // the move uses the id after a length change, which stays the same
      return commit(changes, { focus: id });
    }
    if (b.dataset.scaleDo) {
      const n = Number(b.dataset.scaleDo);
      const f = Number(el.querySelector(`[data-scale="${n}"]`)?.value);
      keepOpen();
      if (!f) { state.editMsg = { id: `week-${n}`, kind: 'error', text: 'Choose how much to change the week first.' }; return render(); }
      const r = applyChanges(state.plan, [{ op: 'scaleWeek', week: n, factor: f }], { today, runs: state.runs, source: 'manual' });
      const res = r.results[0];
      if (!res.ok) { state.editMsg = { id: `week-${n}`, kind: 'error', text: res.error }; return render(); }
      state.plan = r.plan;
      state.editMsg = { id: `week-${n}`, kind: res.warnings.length ? 'warn' : 'ok', text: res.warnings.length ? `Saved, but note: ${res.warnings.join(' ')}` : `Saved: ${res.summary}.` };
      if (storage) await storage.savePlan(state.plan);
      return render();
    }
    if (b.dataset.go) return goto(b.dataset.go, b.dataset.tab);
    if (b.dataset.test) {
      state.plan = insertTest(state.plan, b.dataset.test);
      if (storage) await storage.savePlan(state.plan);
      state.notice = { kind: 'ok', text: 'The session is now a 30-minute test. Copy it to Coros, then upload the file afterwards.' };
      return render();
    }
    if (b.dataset.sg) {
      const kind = b.dataset.sg;
      const s = getSettings();
      const sg = suggestThresholdUpdate({ runs: state.runs, thresholds: s.thresholds, today, raceDate: state.plan.raceDate, state: state.suggestState, easyPaceSecPerKm: state.plan.easyPaceSecPerKm, mode: state.plan.mode });
      const resolve = async () => { state.suggestState = { ...state.suggestState, resolvedOn: today }; if (storage) await storage.saveSuggestState(state.suggestState); };
      if (kind === 'dismiss') { await resolve(); return render(); }
      if (kind === 'accept') {
        await resolve();
        return onUseThreshold({ lthr: sg.lthr?.proposed ?? null, paceSecPerKm: sg.pace?.proposed ?? null, effectiveFrom: nextWorkoutDate(state.plan, today), source: 'suggested' });
      }
      if (kind === 'use-test') {
        return onUseThreshold({ lthr: b.dataset.lthr ? Number(b.dataset.lthr) : null, paceSecPerKm: b.dataset.pace ? Number(b.dataset.pace) : null, effectiveFrom: nextWorkoutDate(state.plan, today), source: 'test' });
      }
    }
    const act = b.dataset.act;
    if (act === 'generate-override') { await refreshRuns(); return generate({ override: true }); }
    if (act === 'generate') { await refreshRuns(); return generate(); }
    if (act === 'regen') { state.confirmRegen = true; state.confirmNew = false; return render(); }
    if (act === 'regen-confirm') { await refreshRuns(); return generate({ keepPast: true }); }
    if (act === 'new') { state.confirmNew = true; state.confirmRegen = false; return render(); }
    if (act === 'cancel-regen') { state.confirmRegen = false; state.confirmNew = false; return render(); }
    if (act === 'csv') {
      const blob = new Blob([planCsv(state.plan, ctx())], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `run-plan-${state.plan.raceDate}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    if (act === 'undo') {
      const label = state.plan.undo.at(-1).label;
      state.plan = undoLast(state.plan);
      state.editMsg = null;
      if (storage) await storage.savePlan(state.plan);
      state.notice = { kind: 'ok', text: `Undone: ${label}.` };
      return render();
    }
    if (act === 'ai-copy') return flash(await copyText(await aiText()), 'The report', 'an AI chat');
    if (act === 'ai-download') {
      const blob = new Blob([await aiText()], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `training-report-${today}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    if (act === 'copy-plan') return flash(await copyText(state.plan.weeks.map((w) => weekText(w, ctx())).join('\n\n\n')), 'The whole plan');
    if (b.dataset.copyWorkout) {
      const [w, week] = findWorkout(b.dataset.copyWorkout);
      return flash(await copyText(workoutText(w, ctx(), week)), 'The workout');
    }
    if (b.dataset.copyWeek) {
      const week = state.plan.weeks.find((x) => x.n === Number(b.dataset.copyWeek));
      return flash(await copyText(weekText(week, ctx())), `Week ${week.n}`);
    }
  });

  async function refreshRuns() { if (storage) state.runs = await storage.listRuns(); }

  if (storage) storage.loadPlan().then((p) => { state.plan = p; state.loaded = true; if (p) { state.messages = p.messages ?? []; render(); } }).catch(() => {});

  return { refresh, getPlan: () => state.plan };
}
