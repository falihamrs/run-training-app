// Plan screen: generate, review and export the plan.
import { generatePlan } from '../core/plan/generate.js';
import { planCsv, stepLines, weekText, workoutText } from '../core/export.js';
import { resolveTargets } from '../core/targets.js';
import { WEEKDAYS, diffDays } from '../core/dates.js';
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
  const state = { plan: null, messages: [], loaded: false, notice: null, confirmRegen: false, open: new Set() };

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
          ? '<span class="notice warn">Replace the current plan? <button type="button" class="primary" data-act="generate">Yes, regenerate</button> <button type="button" data-act="cancel-regen">Cancel</button></span>'
          : '<button type="button" data-act="regen">Regenerate</button>'}
      </p></section>`;
  }

  function stepsHtml(w) {
    const resolved = resolveTargets(w, ctx());
    const lines = stepLines(resolved.steps, { trail: state.plan.mode === 'trail' });
    return `<ol class="steps">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;
  }

  function workoutHtml(w, week) {
    const climb = w.plannedVertM ? ` · ${w.plannedVertM} m` : '';
    const km = w.plannedKm && w.code !== 'RACE' && state.plan.mode === 'road' ? ` · ~${w.plannedKm} km` : '';
    const date = new Date(w.date + 'T00:00:00Z');
    const body = w.code === 'RACE' ? '<p>Good luck. Race fuelling and gear as practised.</p>' : `${stepsHtml(w)}${(w.notes ?? []).map((n) => `<p class="muted small">${esc(n)}</p>`).join('')}`;
    return `<article class="workout role-${esc(w.role)}${w.date === today ? ' today' : ''}">
      <header><strong>${esc(w.weekday)} ${date.getUTCDate()}/${date.getUTCMonth() + 1}</strong> <span class="code">${esc(w.code)}</span> ${esc(w.name)}
        <span class="muted small">${w.plannedMin} min${km}${climb}</span>
        <button type="button" class="link" data-copy-workout="${esc(w.id)}">Copy</button></header>
      ${body}</article>`;
  }

  function weekHtml(week) {
    const trail = state.plan.mode === 'trail';
    const target = trail ? `${week.targetHours} h · ${week.targetVertM} m` : `${week.targetKm} km`;
    const planned = trail ? `${(week.plannedMin / 60).toFixed(1)} h · ${week.plannedVertM} m` : `${week.plannedKm} km`;
    const isCurrent = diffDays(week.start, today) >= 0 && diffDays(week.start, today) < 7;
    const anyCurrent = state.plan.weeks.some((x) => diffDays(x.start, today) >= 0 && diffDays(x.start, today) < 7);
    const open = state.open.has(week.n) || ((isCurrent || (!anyCurrent && week.n === 1)) && !state.open.has(-week.n));
    return `<details class="week${isCurrent ? ' current' : ''}" data-week="${week.n}" ${open ? 'open' : ''}>
      <summary><strong>Week ${week.n}</strong> · ${esc(week.start)} · ${PHASE_LABEL[week.phase]}${week.kind === 'down' ? ' (down week)' : ''} · target ${target} · planned ${planned}${isCurrent ? ' <span class="tag">this week</span>' : ''}</summary>
      <p class="muted small">${esc(week.reason)}</p>
      ${week.flags.map((f) => `<p class="notice warn small">${esc(f)}</p>`).join('')}
      <p><button type="button" class="link" data-copy-week="${week.n}">Copy this week as text</button></p>
      ${week.workouts.map((w) => workoutHtml(w, week)).join('')}
    </details>`;
  }

  function render() {
    el.innerHTML = `${headerCard()}${state.plan ? state.plan.weeks.map(weekHtml).join('') : ''}`;
  }

  async function generate() {
    state.confirmRegen = false;
    state.notice = null;
    const settings = getSettings();
    const history = await getHistory();
    const r = generatePlan(settings, history, { today, id: 'main', now: new Date().toISOString() });
    state.messages = r.messages;
    if (!r.plan) {
      state.plan = null;
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
    if (act === 'generate') return generate();
    if (act === 'regen') { state.confirmRegen = true; return render(); }
    if (act === 'cancel-regen') { state.confirmRegen = false; return render(); }
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

  return { refresh };
}
