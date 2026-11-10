// Turns many analysed runs into the numbers the plan generator starts from.
import { addDays, diffDays, mondayOnOrBefore, localDateOfMs } from './dates.js';
import { oneHourPace } from './riegel.js';

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

/** Drop duplicates: start within 60 s and distance within 2 %. */
export function dedupe(runs) {
  const sorted = [...runs].sort((a, b) => a.startTime - b.startTime);
  const kept = [];
  for (const r of sorted) {
    const dup = kept.some((k) => Math.abs(k.startTime - r.startTime) <= 60000 && Math.abs(k.distanceKm - r.distanceKm) <= 0.02 * Math.max(k.distanceKm, r.distanceKm));
    if (!dup) kept.push(r);
  }
  return kept;
}

function confidenceOf(values, tol = 0.03, better = 'max') {
  if (!values.length) return { best: null, confidence: 'low', supporting: 0 };
  const best = better === 'max' ? Math.max(...values) : Math.min(...values);
  const supporting = values.filter((v) => Math.abs(v - best) / best <= tol).length;
  return { best, confidence: supporting >= 2 ? 'high' : 'medium', supporting };
}

/**
 * Qualifying hard efforts in a set of runs. lthr values are the raw average heart rates of
 * hard 20-minute windows; pace values are flat 30-minute paces (or 20-minute paces x 1.04, or a
 * Riegel 10 km equivalent from a flat race).
 */
export function collectEfforts(pool, easyPaceSecPerKm) {
  const lthr = [];
  const pace = [];
  for (const r of pool) {
    const h = r.efforts?.w20?.hard;
    if (h) {
      const faster = easyPaceSecPerKm && h.paceSecPerKm <= easyPaceSecPerKm * 0.85;
      if (faster || h.gradePct >= 6) lthr.push({ value: h.avgHr, date: r.date, race: Boolean(r.race), runId: r.id });
    }
    const b30 = r.efforts?.w30?.bestPace;
    const b20 = r.efforts?.w20?.bestPace;
    if (b30) pace.push({ value: b30.paceSecPerKm, date: r.date, race: Boolean(r.race), runId: r.id });
    else if (b20) pace.push({ value: b20.paceSecPerKm * 1.04, date: r.date, race: Boolean(r.race), runId: r.id });
    if (r.race && r.distanceKm >= 5 && r.climbDensity < 10) pace.push({ value: oneHourPace(r.movingSec, r.distanceKm), date: r.date, race: true, runId: r.id });
  }
  return { lthr, pace };
}

/**
 * @param runs analysed run records (any order, may contain duplicates)
 * @param opts { planStart, asOf, lthr, selfReport, mode }
 */
export function analyzeHistory(runsIn, { planStart, asOf, lthr = null, selfReport = null, mode = 'trail', tzOffsetMin = 0 } = {}) {
  const runs = dedupe(runsIn).filter((r) => r.distanceKm >= 1);
  const today = asOf || localDateOfMs(Date.now(), tzOffsetMin);
  const refEnd = mondayOnOrBefore(planStart && planStart < today ? planStart : today); // exclusive, a Monday
  const result = {
    runCount: runs.length, weeksCovered: 0, windowWeeks: 0, weekly: [],
    baselineWeeklyKm: 0, baselineWeeklyHours: 0, baselineWeeklyVertM: 0, peakRecentKm: 0,
    longestRunKm: 0, longestRunMin: 0, runsPerWeek: 0, easyPaceSecPerKm: null,
    weeksSinceLastRun: null, returnFromBreak: false, source: 'files',
    trailPaceMinPerKmEffort: null, climbSpeedAtZ2: null, climbSpeedAtZ4: null,
    suggestions: { lthr: { value: null, confidence: 'low' }, thresholdPaceSecPerKm: { value: null, confidence: 'low' } },
    notes: [],
  };

  if (!runs.length) {
    if (selfReport && selfReport.weeklyKm > 0) {
      result.source = 'self-report';
      result.baselineWeeklyKm = selfReport.weeklyKm * 0.8;
      result.runsPerWeek = selfReport.runsPerWeek ?? 0;
      result.longestRunKm = selfReport.longestRunKm ?? 0;
      result.easyPaceSecPerKm = selfReport.easyPaceSecPerKm ?? null;
      result.notes.push('No files: starting from your own numbers at 80 %.');
    } else result.notes.push('No runs yet. Upload files or enter your recent weekly numbers.');
    return result;
  }

  const first = mondayOnOrBefore(runs[0].date);
  const coverage = Math.max(0, Math.floor(diffDays(first, refEnd) / 7));
  const windowWeeks = coverage >= 12 ? 12 : 8;
  result.weeksCovered = coverage;
  result.windowWeeks = windowWeeks;

  const weeks = [];
  for (let w = windowWeeks; w >= 1; w--) {
    const start = addDays(refEnd, -7 * w);
    const end = addDays(start, 6);
    const inWeek = runs.filter((r) => r.date >= start && r.date <= end);
    weeks.push({
      start, runs: inWeek.length, days: new Set(inWeek.map((r) => r.date)).size,
      km: inWeek.reduce((s, r) => s + r.distanceKm, 0),
      hours: inWeek.reduce((s, r) => s + r.movingSec, 0) / 3600,
      vertM: inWeek.reduce((s, r) => s + r.gainM, 0),
    });
  }
  result.weekly = weeks;

  // Weeks before the first uploaded run hold no information, so they are neither a break nor part of the average.
  const covered = weeks.filter((w) => w.start >= first);
  const last4 = covered.slice(-4);
  const meanOf = (k) => mean(last4.map((w) => w[k]));
  let km = meanOf('km'), hours = meanOf('hours'), vert = meanOf('vertM');
  const lastRun = runs.at(-1);
  result.weeksSinceLastRun = Math.floor(diffDays(lastRun.date, refEnd) / 7);
  if (!last4.length) {
    const recent = runs.filter((r) => diffDays(r.date, lastRun.date) < 7);
    km = recent.reduce((s, r) => s + r.distanceKm, 0);
    hours = recent.reduce((s, r) => s + r.movingSec, 0) / 3600;
    vert = recent.reduce((s, r) => s + r.gainM, 0);
    result.notes.push('Less than one full week of history, so the baseline is the runs uploaded so far.');
  } else if (last4.length < 4) {
    result.notes.push(`Only ${last4.length} full week${last4.length === 1 ? '' : 's'} of history, so the baseline is less certain. It firms up as you add runs.`);
  }
  const zeroWeeksLast4 = last4.filter((w) => w.runs === 0).length;
  const nonZeroLast4 = last4.length - zeroWeeksLast4;
  const nonZeroAll = weeks.filter((w) => w.runs > 0);
  if (result.weeksSinceLastRun >= 4 || (zeroWeeksLast4 >= 1 && nonZeroLast4 >= 2) || zeroWeeksLast4 >= 2) {
    result.returnFromBreak = true;
    const nz = nonZeroAll.length ? nonZeroAll : [];
    km = 0.6 * mean(nz.map((w) => w.km));
    hours = 0.6 * mean(nz.map((w) => w.hours));
    vert = 0.6 * mean(nz.map((w) => w.vertM));
    result.notes.push('Break detected: baseline set to 60 % of your active-week average.');
  }
  result.baselineWeeklyKm = km;
  result.baselineWeeklyHours = hours;
  result.baselineWeeklyVertM = vert;
  result.peakRecentKm = Math.max(0, ...weeks.map((w) => w.km));
  result.runsPerWeek = median(last4.map((w) => w.days)) ?? 0;

  const windowStart = weeks[0].start;
  const inWindow = runs.filter((r) => r.date >= windowStart && r.date < refEnd);
  const pool = inWindow.length ? inWindow : runs;
  result.longestRunKm = Math.max(...pool.map((r) => r.distanceKm));
  result.longestRunMin = Math.max(...pool.map((r) => r.movingSec / 60));

  // Easy pace
  let easyRuns = lthr ? pool.filter((r) => r.avgHr != null && r.avgHr <= 0.89 * lthr) : [];
  if (easyRuns.length < 2) {
    const long = pool.filter((r) => r.movingSec > 1800 && r.terrain !== 'hilly');
    const base = long.length >= 2 ? long : pool.filter((r) => r.movingSec > 1800);
    easyRuns = [...base].sort((a, b) => b.avgPaceSecPerKm - a.avgPaceSecPerKm).slice(0, Math.max(1, Math.ceil(base.length / 2)));
  }
  result.easyPaceSecPerKm = median(easyRuns.map((r) => r.avgPaceSecPerKm));

  // Trail extras
  const trail = pool.filter((r) => r.movingSec >= 3600 && r.climbDensity >= 25);
  if (trail.length) {
    result.trailPaceMinPerKmEffort = median(trail.map((r) => r.movingSec / (r.distanceKm + r.gainM / 100) / 60));
  }
  const climbs = pool.flatMap((r) => r.climbs || []);
  const withHr = (lo, hi) => climbs.filter((c) => c.avgHr != null && lthr && c.avgHr >= lo * lthr && c.avgHr <= hi * lthr).map((c) => c.climbSpeedMh);
  const z4 = withHr(0.95, 1.05), z2 = withHr(0.78, 0.89);
  result.climbSpeedAtZ4 = z4.length ? median(z4) : null;
  result.climbSpeedAtZ2 = z2.length ? median(z2) : null;

  // Threshold suggestions
  const eff = collectEfforts(pool, result.easyPaceSecPerKm);
  const lt = confidenceOf(eff.lthr.map((e) => e.value), 0.03, 'max');
  result.suggestions.lthr = lt.best ? { value: Math.round(0.95 * lt.best), confidence: lt.confidence, supporting: lt.supporting } : { value: null, confidence: 'low', supporting: 0 };
  const tp = confidenceOf(eff.pace.map((e) => e.value), 0.03, 'min');
  result.suggestions.thresholdPaceSecPerKm = tp.best ? { value: Math.round(tp.best), confidence: tp.confidence, supporting: tp.supporting } : { value: null, confidence: 'low', supporting: 0 };
  if (result.suggestions.thresholdPaceSecPerKm.confidence === 'low') result.notes.push('No hard flat effort found: do a 30-minute test run and upload it.');
  return result;
}
