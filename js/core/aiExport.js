// A Markdown report of the plan and the training actually done, written to be pasted into an AI chat.
// It carries the context an AI needs to judge the plan: race, thresholds, zones, schedule, then each
// week with planned versus done, and each workout with the run matched to it.
import { addDays, diffDays, weekdayOf } from './dates.js';
import { stepLines } from './export.js';
import { resolveTargets } from './targets.js';
import { earliestThreshold, sortThresholds, thresholdForDate } from './thresholds.js';
import { formatDuration, formatPace } from './units.js';
import { formatHrRange, formatPaceRange, resolveZones } from './zones.js';

const PHASE = { base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper' };
const r1 = (v) => Math.round(v * 10) / 10;
const hm = (min) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} min`;
const mins = (min) => (min >= 60 ? hm(min) : `${Math.round(min)} min`);
const clock = (sec) => { const t = Math.round(sec); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const x = String(t % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
const cell = (v) => String(v ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');

/** Weeks to include: 'recent' = the last 4 finished weeks, the current week and the next 4; 'all' = every week. */
export function weeksInRange(plan, today, range = 'recent') {
  if (!plan) return [];
  if (range === 'all') return plan.weeks;
  const ws = plan.weeks;
  let cur = ws.findIndex((w) => w.start <= today && today <= addDays(w.start, 6));
  if (cur < 0) cur = today < ws[0].start ? -1 : ws.length; // before the plan, or after it
  // the last 4 finished weeks, the current week, and the next 4
  return ws.filter((_, i) => i >= cur - 4 && i <= cur + 4);
}

function runLine(run, trail) {
  const parts = [
    `${r1(run.distanceKm)} km`,
    clock(run.movingSec),
    `${formatPace(run.avgPaceSecPerKm)}/km`,
    run.avgHr ? `avg HR ${Math.round(run.avgHr)}` : 'no HR',
    run.maxHr ? `max ${Math.round(run.maxHr)}` : null,
    `climb ${Math.round(run.gainM)} m${run.manualClimb ? ' (typed in by hand)' : ''}`,
    run.indoor ? 'indoor/treadmill' : null,
    run.race ? 'RACE' : null,
  ].filter(Boolean);
  const lines = [parts.join(', ')];
  if (run.laps?.length >= 2 && run.laps.length <= 40) {
    const typed = run.manualClimb?.basis === 'laps' ? run.manualClimb : null;
    const laps = run.laps.map((l, i) => {
      const pace = l.distM > 0 ? formatPace((l.sec / l.distM) * 1000) : '–';
      const inc = typed ? `, ${typed.unit === 'pct' ? `${typed.values[i] ?? 0}%` : `${typed.values[i] ?? 0} m`}` : '';
      return `${i + 1}: ${clock(l.sec)} ${Math.round(l.distM)} m @ ${pace}${inc}`;
    });
    lines.push(`Laps — ${laps.join('; ')}`);
  } else if (run.manualClimb?.basis !== 'laps' && run.manualClimb?.values?.some((v) => v > 0)) {
    lines.push(`Climbing per km — ${run.manualClimb.values.map((v, i) => `${i + 1}: ${v}${run.manualClimb.unit === 'pct' ? '%' : ' m'}`).join('; ')}`);
  }
  if (trail && run.climbs?.length) {
    lines.push(`Sustained climbs — ${run.climbs.map((c) => `${Math.round(c.gainM)} m at ${r1(c.gradePct)}% in ${Math.round(c.durSec / 60)} min${c.avgHr ? `, HR ${Math.round(c.avgHr)}` : ''}`).join('; ')}`);
  }
  return lines;
}

function workoutBlock(w, ctx, run, today, seen = new Set()) {
  const trail = ctx.mode === 'trail';
  const head = `- **${w.weekday} ${w.date} · ${w.name}** (${w.code})`;
  if (w.code === 'RACE') {
    return [head, run ? `  - Done: ${runLine(run, trail).join('\n    ')}` : `  - ${w.date < today ? 'No run matched.' : 'Upcoming.'}`];
  }
  const plan = [`${mins(w.plannedMin)}`, !trail && w.plannedKm ? `about ${w.plannedKm} km` : null, w.plannedVertM ? `${w.plannedVertM} m climbing` : null].filter(Boolean).join(', ');
  let steps;
  if (w.role === 'S') {
    // the routine is the same every time, so list it once
    const list = w.steps.filter((s) => s.kind === 'exercise').map((s) => `${s.name} ${s.sets}×${s.reps}`).join('; ');
    steps = seen.has(list) ? 'Same routine as above.' : list;
    seen.add(list);
  } else steps = stepLines(resolveTargets(w, ctx).steps, { trail }).join('; ');
  const out = [head, `  - Planned: ${plan}. ${steps}`];
  if (w.role === 'S') return out;
  if (run) {
    const [first, ...rest] = runLine(run, trail);
    out.push(`  - Done: ${first}`);
    for (const l of rest) out.push(`    - ${l}`);
    const d = [];
    d.push(`time ${run.movingSec / 60 - w.plannedMin >= 0 ? '+' : ''}${Math.round(run.movingSec / 60 - w.plannedMin)} min`);
    if (!trail && w.plannedKm) d.push(`distance ${run.distanceKm - w.plannedKm >= 0 ? '+' : ''}${r1(run.distanceKm - w.plannedKm)} km`);
    if (w.plannedVertM) d.push(`climbing ${run.gainM - w.plannedVertM >= 0 ? '+' : ''}${Math.round(run.gainM - w.plannedVertM)} m`);
    out.push(`  - Versus plan: ${d.join(', ')}`);
  } else if (w.date < today) {
    out.push('  - Done: no run matched (missed, or not matched in History).');
  }
  return out;
}

/**
 * @param {object} o
 * @param {object|null} o.plan
 * @param {object[]} o.runs
 * @param {object} o.settings saved settings
 * @param {string} o.today YYYY-MM-DD
 * @param {'recent'|'all'} [o.range]
 * @param {{text:string}[]} [o.advice] the app's current advice for the plan
 * @param {object|null} [o.history] the History summary (baseline)
 */
export function aiReport({ plan, runs, settings, today, range = 'recent', advice = [], history = null }) {
  const mode = plan?.mode ?? settings.race.mode;
  const trail = mode === 'trail';
  const ctx = { thresholds: settings.thresholds, coros: settings.corosZones, mode, goalPaceSecPerKm: plan?.goalPaceSecPerKm ?? null };
  const L = [];
  const race = settings.race;
  L.push('# Running training report');
  L.push('');
  L.push(`Exported ${today} from Run Training Planner. ${range === 'all' ? 'Whole plan.' : 'The last 4 finished weeks, the current week and the next 4 weeks.'}`);
  L.push('Please review how my training is going against the plan and whether the upcoming weeks should change. Paces and heart rates come from my watch files; "typed in by hand" climbing is from a treadmill or a corrected reading.');
  L.push('');

  L.push('## Race and athlete');
  if (trail) {
    const effort = race.distanceKm + (race.elevationGainM ?? 0) / 100;
    L.push(`- Race: trail, ${race.distanceKm} km with ${race.elevationGainM} m climbing (${Math.round(effort)} km-effort), on ${race.date} (${weekdayOf(race.date)})${race.technicality ? `, ${race.technicality} terrain` : ''}.`);
    if (plan?.race?.expectedDurationMin) L.push(`- Expected duration from the app: ${hm(plan.race.expectedDurationMin[0])} to ${hm(plan.race.expectedDurationMin[1])}.`);
  } else {
    L.push(`- Race: road, ${race.distanceKm} km on ${race.date} (${weekdayOf(race.date)}).`);
    if (plan?.race?.predictedSec) L.push(`- Predicted time from the app: ${formatDuration(plan.race.predictedSec)}${plan.goalPaceSecPerKm ? `, goal pace ${formatPace(plan.goalPaceSecPerKm)}/km` : ''}.`);
  }
  if (race.goalTimeSec) L.push(`- Goal time: ${formatDuration(race.goalTimeSec)}.`);
  if (race.cutoffSec) L.push(`- Cut-off: ${formatDuration(race.cutoffSec)}.`);
  L.push(`- Experience: ${settings.athlete?.experience ?? 'not set'}.`);
  const s = settings.schedule;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `${d} ${(s.unavailableDays ?? []).includes(d) ? 'unavailable' : s.dayTerrain?.[d] ?? 'flat'}`);
  L.push(`- Schedule: ${s.runsPerWeek} runs a week, long run on ${s.longRunDay}. Days: ${days.join(', ')}.`);
  if (history) {
    L.push(`- Baseline from my uploaded runs: ${r1(history.baselineWeeklyKm ?? 0)} km and ${r1(history.baselineWeeklyHours ?? 0)} h a week, ${Math.round(history.baselineWeeklyVertM ?? 0)} m climbing, longest run ${r1(history.longestRunKm ?? 0)} km / ${Math.round(history.longestRunMin ?? 0)} min${history.returnFromBreak ? ' (treated as returning from a break)' : ''}.`);
  }
  L.push('');

  L.push('## Thresholds and zones');
  const list = sortThresholds(settings.thresholds);
  for (const e of list) L.push(`- From ${e.effectiveFrom}: LTHR ${e.lthr ?? '–'} bpm, threshold pace ${e.paceSecPerKm != null ? `${formatPace(e.paceSecPerKm)}/km` : '–'} (${e.source}).`);
  if (!list.length) L.push('- No threshold entered yet.');
  const cur = thresholdForDate(settings.thresholds, today) ?? earliestThreshold(settings.thresholds);
  if (cur) {
    L.push('');
    L.push(`Zones in force today${settings.corosZones?.enabled ? ' (heart rate from my Coros zones)' : ''}:`);
    L.push('');
    L.push(`| Zone | Name | Heart rate | Pace${trail ? ' (flat only)' : ''} |`);
    L.push('|---|---|---|---|');
    for (const z of resolveZones({ mode, lthr: cur.lthr, paceSecPerKm: cur.paceSecPerKm, coros: settings.corosZones })) {
      L.push(`| ${z.id} | ${cell(z.name)} | ${formatHrRange(z.hr)} | ${formatPaceRange(z.pace)} |`);
    }
  }
  L.push('');

  if (!plan) {
    L.push('## Plan');
    L.push('No plan has been generated yet.');
    L.push('');
  } else {
    L.push('## Plan overview');
    L.push(`- ${plan.weeks.length} weeks from ${plan.startDate} to ${plan.raceDate}. Peak ${trail ? `${plan.peak.hours} h and ${plan.peak.vertM} m climbing` : `${plan.peak.km} km`} a week.`);
    const runsOf = [];
    for (const w of plan.weeks) {
      const last = runsOf.at(-1);
      if (last && last.phase === w.phase) last.to = w.n; else runsOf.push({ phase: w.phase, from: w.n, to: w.n });
    }
    const down = plan.weeks.filter((w) => w.kind === 'down').map((w) => w.n);
    L.push(`- Phases: ${runsOf.map((p) => `${PHASE[p.phase]} ${p.from === p.to ? `week ${p.from}` : `weeks ${p.from}–${p.to}`}`).join(', ')}.${down.length ? ` Down weeks: ${down.join(', ')}.` : ''}`);
    const msgs = (plan.messages ?? []).filter((m) => m.level !== 'info');
    for (const m of msgs) L.push(`- App warning: ${m.text}`);
    for (const a of advice) L.push(`- App advice now: ${a.text}`);
    L.push('');
  }

  // runs by workout, and runs that match nothing
  const byWorkout = new Map(runs.filter((r) => r.matchedWorkoutId).map((r) => [r.matchedWorkoutId, r]));
  const weeks = weeksInRange(plan, today, range);
  if (weeks.length) {
    L.push('## Weeks');
    L.push('');
    L.push(`| Week | Start | Phase | Target | Planned | Done | Runs done |`);
    L.push('|---|---|---|---|---|---|---|');
    const done = (w) => {
      const end = addDays(w.start, 6);
      const inWeek = runs.filter((r) => r.date >= w.start && r.date <= end);
      return { inWeek, km: inWeek.reduce((a, r) => a + r.distanceKm, 0), min: inWeek.reduce((a, r) => a + r.movingSec / 60, 0), vert: inWeek.reduce((a, r) => a + r.gainM, 0) };
    };
    for (const w of weeks) {
      const d = done(w);
      const future = w.start > today;
      const tgt = trail ? `${w.targetHours} h, ${w.targetVertM} m` : `${w.targetKm} km`;
      const pl = trail ? `${r1(w.plannedMin / 60)} h, ${w.plannedVertM} m` : `${w.plannedKm} km`;
      const dn = future ? '–' : trail ? `${r1(d.min / 60)} h, ${Math.round(d.vert)} m` : `${r1(d.km)} km`;
      L.push(`| ${w.n}${w.start <= today && today <= addDays(w.start, 6) ? ' (this week)' : ''} | ${w.start} | ${PHASE[w.phase]}${w.kind === 'down' ? ' (down)' : ''} | ${tgt} | ${pl} | ${dn} | ${future ? '–' : d.inWeek.length} |`);
    }
    L.push('');
    const seen = new Set();
    for (const w of weeks) {
      L.push(`### Week ${w.n} · ${w.start} · ${PHASE[w.phase]}${w.kind === 'down' ? ' (down week)' : ''}`);
      for (const f of w.flags ?? []) L.push(`> ${f}`);
      for (const x of w.workouts) L.push(...workoutBlock(x, ctx, byWorkout.get(x.id) ?? null, today, seen));
      const ids = new Set(w.workouts.map((x) => x.id));
      const end = addDays(w.start, 6);
      const extra = runs.filter((r) => r.date >= w.start && r.date <= end && (!r.matchedWorkoutId || !ids.has(r.matchedWorkoutId)));
      for (const r of extra) {
        const [first, ...rest] = runLine(r, trail);
        L.push(`- **${weekdayOf(r.date)} ${r.date} · Unplanned or unmatched run**: ${first}`);
        for (const l of rest) L.push(`  - ${l}`);
      }
      L.push('');
    }
  }

  // runs before the plan (or all runs when there is no plan) in the last 8 weeks
  const firstDay = plan?.weeks.length ? (range === 'all' ? plan.weeks[0].start : weeks[0]?.start ?? plan.weeks[0].start) : null;
  const since = addDays(today, -56);
  const before = runs.filter((r) => r.date >= since && r.date <= today && (!firstDay || r.date < firstDay)).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (before.length) {
    L.push(plan ? '## Runs before the weeks above (last 8 weeks)' : '## Recent runs (last 8 weeks)');
    for (const r of before) {
      const [first, ...rest] = runLine(r, trail);
      L.push(`- **${weekdayOf(r.date)} ${r.date}**: ${first}`);
      for (const l of rest) L.push(`  - ${l}`);
    }
    L.push('');
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
