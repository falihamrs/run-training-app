// Section 8: resolve a workout's relative zones into concrete targets for its date.
import { earliestThreshold, thresholdForDate } from './thresholds.js';
import { resolveZones } from './zones.js';

const trailZone = (z) => (z === 'Z5a' || z === 'Z5b' || z === 'Z5c' ? 'Z5' : z);

export function entryForDate(thresholds, date) {
  return thresholdForDate(thresholds, date) ?? earliestThreshold(thresholds) ?? null;
}

function resolveOne(part, ctx, zoneMap, trail, shortSec) {
  const zoneId = trail ? trailZone(part.zone) : part.zone;
  if (zoneId === 'RP') {
    const g = ctx.goalPaceSecPerKm;
    return {
      zone: 'RP', rpe: null, hr: null,
      pace: g ? { fast: Math.round(g * 0.985), slow: Math.round(g * 1.015) } : null,
      hrInfoOnly: false,
    };
  }
  const z = zoneMap[zoneId];
  if (!z) return { zone: zoneId, hr: null, pace: null, rpe: null, hrInfoOnly: false };
  let hr = z.hr;
  let pace = z.pace;
  if (trail && !part.flat) pace = null; // no pace on climbs or descents
  if (trail && part.flat === undefined && part.rpe === undefined) pace = null;
  let hrInfoOnly = false;
  if (!trail && shortSec != null && shortSec < 180 && hr && pace) hrInfoOnly = true;
  if (zoneId === 'Z5c') hr = null; // heart rate is not used for short repetitions
  const rpe = part.rpe ?? z.rpe ?? null;
  if (part.zoneHigh) {
    const hi = zoneMap[trail ? trailZone(part.zoneHigh) : part.zoneHigh];
    if (hi?.hr && hr) hr = { lo: hr.lo, hi: hi.hr.hi };
  }
  return { zone: zoneId, hr, pace, rpe, hrInfoOnly };
}

const secOf = (p) => (p.durationSec != null ? p.durationSec : (p.durationMin ?? 0) * 60);

/**
 * @param workout a plan workout
 * @param ctx { thresholds, coros, mode, goalPaceSecPerKm }
 * @returns {{entry, steps}} steps carry a `target` (and for repeats, `workTarget` and `recTarget`)
 */
export function resolveTargets(workout, ctx) {
  const trail = ctx.mode === 'trail';
  const entry = entryForDate(ctx.thresholds, workout.date);
  const zones = resolveZones({ mode: ctx.mode, lthr: entry?.lthr ?? null, paceSecPerKm: entry?.paceSecPerKm ?? null, coros: ctx.coros });
  const zoneMap = Object.fromEntries(zones.map((z) => [z.id, z]));
  const steps = workout.steps.map((s) => {
    if (s.kind === 'exercise') return s;
    if (s.kind === 'repeat') {
      const flat = s.flat;
      return {
        ...s,
        workTarget: resolveOne({ ...s.work, flat }, ctx, zoneMap, trail, secOf(s.work)),
        recTarget: s.rec ? resolveOne({ ...s.rec, flat: true }, ctx, zoneMap, trail, null) : null,
      };
    }
    return { ...s, target: resolveOne(s, ctx, zoneMap, trail, s.kind === 'strides' ? secOf({ durationSec: s.durationSec }) : secOf(s)) };
  });
  return { entry: entry ? { effectiveFrom: entry.effectiveFrom, lthr: entry.lthr ?? null, paceSecPerKm: entry.paceSecPerKm ?? null } : null, steps };
}

/** What gets stored when a run is matched to a workout. Later threshold changes never rewrite it. */
export function prescribedSnapshot(workout, ctx) {
  const r = resolveTargets(workout, ctx);
  return { thresholdEffectiveFrom: r.entry?.effectiveFrom ?? null, entry: r.entry, steps: r.steps, plannedMin: workout.plannedMin, plannedKm: workout.plannedKm, plannedVertM: workout.plannedVertM };
}
