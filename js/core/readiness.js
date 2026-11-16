// Race readiness: what the last full weeks (up to 4) of real running look like next to what the plan asked for
// in those weeks and next to the plan's peak. Pure numbers; the page turns them into bars.
import { addDays, diffDays, mondayOnOrBefore } from './dates.js';

const r1 = (v) => Math.round(v * 10) / 10;

/** @returns {'none'|'ok'|'near'|'behind'} */
export function readinessStatus(now, planned) {
  if (planned == null || planned <= 0) return 'none';
  const ratio = now / planned;
  return ratio >= 0.85 ? 'ok' : ratio >= 0.6 ? 'near' : 'behind';
}

/**
 * @returns {null | { weeksToRace:number, window:{from:string,to:string}, planWeeks:number, rows:Array<{key,label,unit,now,planned,peak,status}>, overall:string }}
 */
export function readiness(plan, runs, today) {
  if (!plan?.weeks?.length) return null;
  const trail = plan.mode === 'trail';
  const thisMonday = mondayOnOrBefore(today);
  const from = addDays(thisMonday, -28);
  const to = addDays(thisMonday, -1);
  const weeks = plan.weeks.filter((w) => w.start >= from && w.start <= to);
  const n = weeks.length;
  // compare like with like: once the plan has finished weeks, only those weeks count on both sides
  const first = n ? weeks[0].start : from;
  const span = n || 4;
  const recent = runs.filter((r) => r.date >= first && r.date <= to);
  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
  const avgPlan = (f) => (n ? sum(weeks, f) / n : null);
  const longs = weeks.flatMap((w) => w.workouts.filter((x) => x.role === 'L'));
  const maxOf = (arr, f) => arr.reduce((m, x) => Math.max(m, f(x) || 0), 0);

  const rows = trail
    ? [
        { key: 'long', label: 'Longest run', unit: 'min', now: Math.round(maxOf(recent, (r) => r.movingSec / 60)), planned: n ? maxOf(longs, (w) => w.plannedMin) : null, peak: plan.peak?.longRunMin ?? null },
        { key: 'hours', label: 'Weekly time', unit: 'h', now: r1(sum(recent, (r) => r.movingSec) / 3600 / span), planned: n ? r1(avgPlan((w) => w.plannedMin) / 60) : null, peak: plan.peak?.hours ?? null },
        { key: 'vert', label: 'Weekly climbing', unit: 'm', now: Math.round(sum(recent, (r) => r.gainM) / span), planned: n ? Math.round(avgPlan((w) => w.plannedVertM)) : null, peak: plan.peak?.vertM ?? null },
      ]
    : [
        { key: 'long', label: 'Longest run', unit: 'km', now: r1(maxOf(recent, (r) => r.distanceKm)), planned: n ? r1(maxOf(longs, (w) => w.plannedKm)) : null, peak: plan.peak?.longRunKm ?? null },
        { key: 'km', label: 'Weekly distance', unit: 'km', now: r1(sum(recent, (r) => r.distanceKm) / span), planned: n ? r1(avgPlan((w) => w.plannedKm)) : null, peak: plan.peak?.km ?? null },
      ];
  for (const row of rows) row.status = readinessStatus(row.now, row.planned);

  const st = rows.map((r) => r.status);
  const overall = st.every((s) => s === 'none') ? 'none' : st.includes('behind') ? 'behind' : st.includes('near') ? 'near' : 'ok';
  return { weeksToRace: Math.max(0, Math.ceil(diffDays(today, plan.raceDate) / 7)), window: { from: first, to }, planWeeks: n, rows, overall };
}
