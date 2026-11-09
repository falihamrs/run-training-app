// Plan screen: generate, review and export the plan.
import { generatePlan } from '../core/plan/generate.js';
import { planCsv, stepLines, weekText, workoutText } from '../core/export.js';
import { resolveTargets } from '../core/targets.js';
import { WEEKDAYS, diffDays, nextMonday } from '../core/dates.js';
import { compareRun, planAdvice, regenerateFrom, runsByWorkout, weekProgress, workoutStatus } from '../core/tracking.js';
import { formatDuration } from '../core/units.js';
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

export function mountPlan(el, { storage, today, getSettings, getHistory, goto }) {
  const state = { plan: null, messages: [], loaded: false, notice: null, confirmRegen: false, confirmNew: false, open: new Set(), runs: [] };

  const ctx = () => {
    const s = getSettings();
    return { thresholds: s.thresholds, coros: s.corosZones, mode: state.plan?.mode ?? s.race.mode, goalPaceSecPerKm: state.plan?.goalPaceSecPerKm ?? null };
  };

  function messagesHtml(list) {
    if (!list.length) return '';
    return `<ul class="checks">${list.map((m) => `<li class="${m.level === 'block' ? 'err' : m.level === 'warn' ? 'warn' : ''}">${esc(m.text)}</li>`).join('')}</ul>`;
  }

  function headerCard() {
    const p = state.plan;
    if (!p) {
      return `<section class="card"><h2>Create your plan</h2>
        <p class="muted">The plan uses the race, schedule and thresholds from Settings and the baseline from History. Save your settings first.</p>
        ${messagesHtml(state.messages)}
        <p><button type="button" class="primary" data-act="generate" ${storage ? '' : 'disabled'}>Generate plan</button>
        <button type="button" class="link" data-go="settings">Open settings</button> <button type="button" class="link" data-go="history">Open history</button></p></section>`;
    }
    const trail = p.mode === 'trail';
    const race = p.race;
    const facts = trail
      ? `${race.distanceKm} km, ${race.elevationGainM} m climbing (${race.kmEffort.toFixed(0)} km-effort). Expected duration ${hm(race.expectedDurationMin[0])} to ${hm(race.expectedDurationMin[1])}.`
      : `${race.distanceKm} km. Predicted time ${formatDuration(Math.round(race.predictedSec * 0.97))} to ${formatDuration(Math.round(race.predictedSec * 1.03))}${p.goalPaceSecPerKm ? `, goal pace ${Math.floor(p.goalPaceSecPerKm / 60)}:${String(p.goalPaceSecPerKm % 60).padStart(2, '0')}/km` : ''}.`;
    const peak = trail ? `Peak ${p.peak.hours} h and ${p.peak.vertM} m a week.` : `Peak ${p.peak.km} km a week.`;
    return `<section class="card"><h2>${esc(p.mode === 'trail' ? 'Trail' : 'Road')} plan: ${esc(p.startDate)} to ${esc(p.raceDate)} <span class="tag ${p.status === 'WARN' ? 'coros' : ''}">${esc(p.status)}</span></h2>
      <p>${esc(facts)} ${esc(peak)} ${p.weeks.length} weeks.</p>
      ${messagesHtml(state.messages)}
      ${state.notice ? `<p class="notice ${state.notice.kind}">${esc(state.notice.text)}</p>` : ''}
      <p class="row">
        <button type="button" data-act="csv">Download CSV</button>
        <button type="button" data-act="copy-plan">Copy all weeks as text</button>
        ${state.confirmRegen
          ? `<span class="notice warn">Regenerate from ${esc(nextMonday(today))}? Weeks before that stay as they are. <button type="button" class="primary" data-act="regen-confirm">Yes, regenerate</button> <button type="button" data-act="cancel-regen">Cancel</button></span>`
          : '<button type="button" data-act="regen">Regenerate from next Monday</button>'}
        ${state.confirmNew
          ? '<span class="notice warn">Discard this plan and start a new one? Matched runs keep their record. <button type="button" class="primary" data-act="generate">Yes, start over</button> <button type="button" data-act="cancel-regen">Cancel</button></span>'
          : '<button type="button" data-act="new">Start a new plan</button>'}
      </p>
      ${adviceHtml()}</section>`;
  }

  function adviceHtml() {
    const adv = planAdvice(state.plan, state.runs, today);
    if (!adv.length) return '';
    return adv.map((a) => `<p class="notice warn">${esc(a.text)} <button type="button" data-act="regen">Regenerate from next Monday</button></p>`).join('');
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
        <button type="button" class="link" data-copy-workout="${esc(w.id)}">Copy</button></header>
      ${body}${actual}</article>`;
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
      ${week.workouts.map((w) => workoutHtml(w, week)).join('')}
    </details>`;
  }

  function render() {
    el.innerHTML = `${headerCard()}${state.plan ? state.plan.weeks.map(weekHtml).join('') : ''}`;
  }

  async function generate({ keepPast = false } = {}) {
    state.confirmRegen = false;
    state.confirmNew = false;
    state.notice = null;
    const settings = getSettings();
    const now = new Date().toISOString();
    let r;
    if (keepPast && state.plan) {
      const history = await getHistory({ planStart: nextMonday(today) });
      r = regenerateFrom(state.plan, settings, history, { today, now });
    } else {
      const history = await getHistory();
      r = generatePlan(settings, history, { today, id: 'main', now });
    }
    state.messages = r.messages;
    if (!r.plan) {
      if (!keepPast) state.plan = null;
      else state.notice = { kind: 'error', text: 'The plan could not be regenerated. See the messages above; your current plan is unchanged.' };
      render();
      return;
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
    }
    if (storage) state.runs = await storage.listRuns();
    render();
  }

  function findWorkout(id) {
    for (const w of state.plan.weeks) for (const x of w.workouts) if (x.id === id) return [x, w];
    return [null, null];
  }

  async function flash(ok, what) {
    state.notice = ok ? { kind: 'ok', text: `${what} copied. Paste it into your notes or the Coros app.` } : { kind: 'error', text: 'Copying was blocked by the browser. Select the text manually.' };
    const keep = [...el.querySelectorAll('details[open]')].map((d) => Number(d.dataset.week));
    keep.forEach((n) => state.open.add(n));
    render();
  }

  el.addEventListener('toggle', (e) => {
    const d = e.target.closest?.('details.week');
    if (!d) return;
    const n = Number(d.dataset.week);
    if (d.open) { state.open.add(n); state.open.delete(-n); } else { state.open.delete(n); state.open.add(-n); }
  }, true);

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act],[data-copy-workout],[data-copy-week],[data-go]');
    if (!b) return;
    if (b.dataset.go) return goto(b.dataset.go);
    const act = b.dataset.act;
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

  if (storage) storage.loadPlan().then((p) => { state.plan = p; state.loaded = true; if (p) render(); }).catch(() => {});

  return { refresh, getPlan: () => state.plan };
}
