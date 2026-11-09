// Section 8: threshold update suggestions, goal advice and the optional test workout.
import { addDays, diffDays } from './dates.js';
import { collectEfforts } from './history.js';
import { thresholdForDate, earliestThreshold } from './thresholds.js';
import { predictRoadTime } from './plan/tables.js';
import { totalMinutes } from './plan/workouts.js';

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function pick(cands, better, today, tol = 0.03) {
  const recent = cands.filter((c) => diffDays(c.date, today) >= 0 && (diffDays(c.date, today) <= 28 || (c.race && diffDays(c.date, today) <= 42)));
  if (!recent.length) return null;
  const best = recent.reduce((a, c) => (better === 'max' ? (c.value > a.value ? c : a) : (c.value < a.value ? c : a)));
  const support = recent.filter((c) => Math.abs(c.value - best.value) / best.value <= tol);
  const ok = support.length >= 2 || support.some((c) => c.race || c.test);
  return ok ? { value: best.value, support } : null;
}

/**
 * @returns {{kind:'none'|'update'|'retest'|'test-needed', reason?, lthr?, pace?, evidence:string[]}}
 */
export function suggestThresholdUpdate({ runs, thresholds, today, raceDate = null, state = {}, easyPaceSecPerKm = null, mode = 'road' }) {
  const none = (reason) => ({ kind: 'none', reason, evidence: [] });
  const cur = thresholdForDate(thresholds, today) ?? earliestThreshold(thresholds);
  if (!cur) return none('no-thresholds');
  if (raceDate && diffDays(today, raceDate) <= 10) return none('race-close');
  if (state.resolvedOn && diffDays(state.resolvedOn, today) < 21) return none('cooldown');

  const pool = runs.filter((r) => diffDays(r.date, today) >= 0 && diffDays(r.date, today) <= 42);
  const eff = collectEfforts(pool, easyPaceSecPerKm);
  const evidence = [];

  const hrPick = pick(eff.lthr, 'max', today);
  const pacePick = mode === 'trail' && !cur.paceSecPerKm ? null : pick(eff.pace, 'min', today);
  const out = { kind: 'none', evidence };

  let up = false, down = false, needTest = false;
  if (hrPick && cur.lthr != null) {
    const est = Math.round(0.95 * hrPick.value);
    const diff = est - cur.lthr;
    out.lthr = { current: cur.lthr, estimated: est, proposed: null };
    if (diff >= 3) {
      if (diff > 4) needTest = true; else { out.lthr.proposed = est; up = true; }
      evidence.push(`${hrPick.support.length} hard effort${hrPick.support.length > 1 ? 's' : ''} suggest an LTHR near ${est} bpm (now ${cur.lthr}).`);
    } else if (diff <= -3) { down = true; evidence.push(`Recent hard efforts point to a lower LTHR of about ${est} bpm (now ${cur.lthr}).`); }
  }
  if (pacePick && cur.paceSecPerKm != null) {
    const est = Math.round(pacePick.value);
    out.pace = { current: cur.paceSecPerKm, estimated: est, proposed: null };
    if (est <= cur.paceSecPerKm * 0.98) {
      if (est < cur.paceSecPerKm * 0.97) needTest = true;
      else { out.pace.proposed = est; up = true; }
      evidence.push(`${pacePick.support.length} flat hard effort${pacePick.support.length > 1 ? 's' : ''} suggest a threshold pace near ${Math.floor(est / 60)}:${String(est % 60).padStart(2, '0')} (now ${Math.floor(cur.paceSecPerKm / 60)}:${String(cur.paceSecPerKm % 60).padStart(2, '0')}).`);
    } else if (est >= cur.paceSecPerKm * 1.02) {
      down = true;
      evidence.push('Recent hard efforts are slower than your threshold pace.');
    }
  }
  if (needTest) out.kind = 'test-needed';
  else if (up) out.kind = 'update';
  else if (down) out.kind = 'retest';
  return out;
}

/** Climbing speed (m/h) at Z4 heart rate: last 4 weeks against the 4 weeks before. */
export function climbTrend(runs, lthr, today) {
  if (!lthr) return null;
  const speeds = (from, to) => runs.filter((r) => diffDays(r.date, today) >= from && diffDays(r.date, today) < to)
    .flatMap((r) => r.climbs || []).filter((c) => c.avgHr != null && c.avgHr >= 0.95 * lthr && c.avgHr <= 1.05 * lthr).map((c) => c.climbSpeedMh);
  const recent = speeds(0, 28);
  const before = speeds(28, 56);
  if (recent.length < 2 || !before.length) return null;
  const pct = (median(recent) / median(before) - 1) * 100;
  return { pct: Math.round(pct * 10) / 10, recentMh: Math.round(median(recent)), beforeMh: Math.round(median(before)), significant: pct >= 5 };
}

/** If the predicted time is 3% or more faster than the goal, suggest a new goal. Never changes it silently. */
export function goalAdvice({ goalTimeSec, thresholdPaceSecPerKm, distanceKm }) {
  if (!goalTimeSec || !thresholdPaceSecPerKm) return null;
  const predicted = predictRoadTime(thresholdPaceSecPerKm, distanceKm);
  if (predicted <= goalTimeSec * 0.97) return { predictedSec: predicted, suggestedGoalSec: Math.round(predicted / 60) * 60 };
  return null;
}

// ----- optional 30-minute test -----

export function canInsertTest(plan, workout, today) {
  if (!plan || !workout || workout.role === 'S' || workout.date < today) return false;
  const week = plan.weeks.find((w) => w.n === workout.week);
  if (!week || !['build', 'peak'].includes(week.phase) || week.kind === 'down' || week.locked) return false;
  const trail = plan.mode === 'trail';
  const climb = trail && ['CLB', 'HIKE', 'DWN', 'HIL', 'INC'].includes(workout.code) && workout.role === 'Q2';
  if (!(workout.role === 'Q1' || climb)) return false;
  if (diffDays(workout.date, plan.raceDate) < 21) return false;
  const tests = plan.weeks.flatMap((w) => w.workouts).filter((w) => w.code === 'TEST');
  return !tests.some((t) => Math.abs(diffDays(t.date, workout.date)) < 56);
}

export function insertTest(plan, workoutId) {
  const trail = plan.mode === 'trail';
  const weeks = plan.weeks.map((w) => ({
    ...w,
    workouts: w.workouts.map((x) => {
      if (x.id !== workoutId) return x;
      const climb = trail && x.role === 'Q2';
      const steps = [
        { kind: 'warmup', durationMin: 15, zone: 'Z2' },
        { kind: 'work', durationMin: 30, zone: climb ? 'Z4' : 'Z4', flat: !climb, note: climb ? 'Steady hard climb, even effort. Note the metres climbed' : 'Hardest even effort you can hold for 30 minutes', test: true },
        { kind: 'cooldown', durationMin: 10, zone: 'Z1' },
      ];
      return { ...x, code: 'TEST', name: climb ? '30-minute climb test' : '30-minute time trial', steps, plannedMin: totalMinutes(steps), plannedVertM: 0, locked: true, notes: ['Replaces the planned quality session. Upload the file afterwards to get a threshold suggestion.'] };
    }),
  }));
  return { ...plan, weeks };
}

/** Threshold pace is the 30-minute pace; LTHR is the average heart rate of the hardest 20 minutes. */
export function testResultFromRun(run) {
  const pace = run?.efforts?.w30?.bestPace?.paceSecPerKm ?? null;
  const hr = run?.efforts?.w20?.hard?.avgHr ?? null;
  return { paceSecPerKm: pace != null ? Math.round(pace) : null, lthr: hr != null ? Math.round(hr) : null };
}

export function nextWorkoutDate(plan, today) {
  const dates = plan.weeks.flatMap((w) => w.workouts).filter((w) => w.role !== 'S' && w.date >= today).map((w) => w.date).sort();
  return dates[0] ?? addDays(today, 1);
}
