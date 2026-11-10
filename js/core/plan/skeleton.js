// Section 5: phases and weekly volume.
import { ROAD_RAMP, TRAIL_RAMP, round025, round50 } from './tables.js';

const MAX_RAMP_WEEKS = 24;

export function splitPhases(R) {
  let base = Math.max(2, Math.round(0.35 * R));
  let peak = Math.max(2, Math.round(0.25 * R));
  while (base + peak > R - 1 && (base > 1 || peak > 1)) {
    if (peak > 1) peak--; else base--;
  }
  return { base, peak, build: Math.max(0, R - base - peak) };
}

/** Run a loading/down-week progression of n weeks. `down` follows every 4th week. */
function progression(n, { first, grow, down, cap }) {
  const out = [];
  let last = Math.min(first, cap);
  for (let w = 1; w <= n; w++) {
    if (w === 1) out.push({ v: last, kind: 'load' });
    else if (w % 4 === 0) out.push({ v: down(last), kind: 'down' });
    else {
      last = Math.min(cap, grow(last));
      out.push({ v: last, kind: 'load' });
    }
  }
  return out;
}

/**
 * Build the week-by-week volume skeleton.
 * @returns {{weeks:object[], phases:object, holdWeeks:number}}
 */
export function buildVolume(params, history, settings) {
  const { W, trail, xp } = params;
  // A race on Monday or Tuesday leaves no training in its own week, so that week is a stub and the
  // taper applies to the weeks before it.
  const stub = params.earlyRace ? 1 : 0;
  const taperWeeks = Math.max(0, Math.min(params.taperWeeks, Math.max(1, W - stub - 1), W - stub));
  const series = (R) => {
    if (trail) {
      const ramp = TRAIL_RAMP[xp];
      const load = progression(R, {
        first: round025(history.baselineWeeklyHours ?? 0),
        // at least +0.25 h, or rounding to 0.25 h would hold low volumes flat forever
        grow: (h) => Math.min(h + 1.5, Math.max(h + 0.25, round025(h * (1 + ramp)))),
        down: (h) => round025(0.8 * h),
        cap: params.peakHours,
      });
      const v0 = Math.round(Math.max(history.baselineWeeklyVertM ?? 0, 100) / 10) * 10;
      const vert = progression(R, {
        first: v0,
        grow: (v) => round50(v + Math.min(250, Math.max(ramp * v, 100))),
        down: (v) => round50(0.8 * v),
        cap: params.peakVert,
      });
      return { load, vert, caps: [[load, params.peakHours], [vert, params.peakVert]] };
    }
    const ramp = ROAD_RAMP[xp];
    const load = progression(R, {
      first: Math.round(history.baselineWeeklyKm ?? 0),
      grow: (k) => Math.min(k + 8, Math.max(k + 1, Math.round(k * (1 + ramp)))),
      down: (k) => Math.round(0.8 * k),
      cap: params.peakKm,
    });
    return { load, vert: null, caps: [[load, params.peakKm]] };
  };
  // Plans longer than 24 weeks hold the current volume first, but only for weeks the ramp does not need:
  // the build must still reach its peak targets by the start of the peak phase.
  // A plan that is being regenerated mid-way never goes back to hold weeks.
  let hold = params.resumePhases ? 0 : Math.max(0, W - stub - MAX_RAMP_WEEKS);
  let R, phases, built;
  for (;;) {
    R = Math.max(0, W - hold - taperWeeks - stub);
    phases = splitPhases(R);
    built = series(R);
    const deadline = R - phases.peak + 1;
    const inTime = built.caps.every(([list, cap]) => { const i = list.findIndex((x) => x.v >= cap); return i >= 0 && i + 1 <= deadline; });
    if (inTime || hold === 0 || R === 0) break;
    hold -= 1;
  }
  const weeks = [];
  const loadSeries = built.load;
  const vertSeries = built.vert;
  let peakKm = 0, peakH = 0, peakV = 0;
  if (trail) {
    peakH = loadSeries.length ? Math.max(...loadSeries.map((x) => x.v)) : Math.min(params.peakHours, round025(history.baselineWeeklyHours ?? 0));
    peakV = vertSeries.length ? Math.max(...vertSeries.map((x) => x.v)) : Math.min(params.peakVert, Math.round(history.baselineWeeklyVertM ?? 0));
  } else {
    peakKm = loadSeries.length ? Math.max(...loadSeries.map((x) => x.v)) : Math.min(params.peakKm, Math.round(history.baselineWeeklyKm ?? 0));
  }

  const baseKm = Math.round(history.baselineWeeklyKm ?? 0);
  const baseH = round025(history.baselineWeeklyHours ?? 0);
  const baseV = Math.round(Math.max(history.baselineWeeklyVertM ?? 0, 100) / 10) * 10;
  for (let i = 0; i < hold; i++) {
    weeks.push({
      n: i + 1, kind: 'hold', phase: 'base',
      ...(trail ? { targetHours: baseH, targetVertM: baseV } : { targetKm: baseKm }),
      reason: 'Held at your current volume: the race is far enough away that the build does not need this week yet.',
    });
  }

  // A regenerated plan keeps the phase each remaining week already had, so training does not restart from Base.
  const resumed = params.resumePhases?.filter((p) => p !== 'taper') ?? null;
  const phaseFor = (i) => (resumed ? resumed[i - 1] ?? 'peak' : i <= phases.base ? 'base' : i <= phases.base + phases.build ? 'build' : 'peak');
  for (let i = 1; i <= R; i++) {
    const s = loadSeries[i - 1];
    const phase = phaseFor(i);
    const w = { n: hold + i, kind: s.kind, phase };
    if (trail) {
      w.targetHours = s.v;
      w.targetVertM = vertSeries[i - 1].v;
      const atCap = s.v >= params.peakHours;
      w.reason = s.kind === 'down' ? 'Down week at 80% of the last loading week.' : i === 1 ? 'Starts from your baseline.' : atCap ? 'Hours are held at the peak target.' : 'Loading week with a gradual increase.';
    } else {
      w.targetKm = s.v;
      w.reason = s.kind === 'down' ? 'Down week at 80% of the last loading week.' : i === 1 ? 'Starts from your baseline.' : s.v >= params.peakKm ? 'Held at the peak target.' : 'Loading week with a gradual increase.';
    }
    weeks.push(w);
  }

  for (let t = 0; t < taperWeeks; t++) {
    const w = { n: hold + R + t + 1, kind: 'taper', phase: 'taper' };
    if (trail) {
      // a shortened taper keeps the shares closest to the race
      const hs = params.cls.taperHours.slice(-taperWeeks);
      const vs = params.cls.taperVert.slice(-taperWeeks);
      w.targetHours = round025(peakH * hs[Math.min(t, hs.length - 1)]);
      w.targetVertM = round50(peakV * vs[Math.min(t, vs.length - 1)]);
    } else {
      w.targetKm = Math.round(peakKm * params.table.taper.slice(-taperWeeks)[t]);
    }
    w.reason = t === taperWeeks - 1 ? (stub ? 'Final taper week: the race is early next week.' : 'Race week: volume excludes the race itself.') : 'Taper: reduced volume, short sharp sessions.';
    weeks.push(w);
  }
  if (stub) {
    weeks.push({ n: hold + R + taperWeeks + 1, kind: 'taper', phase: 'taper', ...(trail ? { targetHours: 0, targetVertM: 0 } : { targetKm: 0 }), reason: 'Race week: only the race, and a shakeout if the day before is free.' });
  }
  return { weeks, phases, holdWeeks: hold, peakKm, peakHours: peakH, peakVertM: peakV };
}
