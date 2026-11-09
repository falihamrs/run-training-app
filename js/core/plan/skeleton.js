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
  const { W, trail, xp, taperWeeks } = params;
  const hold = Math.max(0, W - MAX_RAMP_WEEKS);
  const Wp = W - hold;
  const R = Wp - taperWeeks;
  const phases = splitPhases(R);
  const weeks = [];

  let loadSeries;
  let vertSeries = null;
  let peakKm = 0, peakH = 0, peakV = 0;
  if (trail) {
    const ramp = TRAIL_RAMP[xp];
    loadSeries = progression(R, {
      first: round025(history.baselineWeeklyHours ?? 0),
      grow: (h) => Math.min(h + 1.5, round025(h * (1 + ramp))),
      down: (h) => round025(0.8 * h),
      cap: params.peakHours,
    });
    const v0 = Math.round(Math.max(history.baselineWeeklyVertM ?? 0, 100) / 10) * 10;
    vertSeries = progression(R, {
      first: v0,
      grow: (v) => round50(v + Math.min(250, Math.max(ramp * v, 100))),
      down: (v) => round50(0.8 * v),
      cap: params.peakVert,
    });
    peakH = Math.max(...loadSeries.map((s) => s.v));
    peakV = Math.max(...vertSeries.map((s) => s.v));
  } else {
    const ramp = ROAD_RAMP[xp];
    loadSeries = progression(R, {
      first: Math.round(history.baselineWeeklyKm ?? 0),
      grow: (k) => Math.min(k + 8, Math.round(k * (1 + ramp))),
      down: (k) => Math.round(0.8 * k),
      cap: params.peakKm,
    });
    peakKm = Math.max(...loadSeries.map((s) => s.v));
  }

  const baseKm = Math.round(history.baselineWeeklyKm ?? 0);
  const baseH = round025(history.baselineWeeklyHours ?? 0);
  const baseV = Math.round(Math.max(history.baselineWeeklyVertM ?? 0, 100) / 10) * 10;
  for (let i = 0; i < hold; i++) {
    weeks.push({
      n: i + 1, kind: 'hold', phase: 'base',
      ...(trail ? { targetHours: baseH, targetVertM: baseV } : { targetKm: baseKm }),
      reason: 'Held at your current volume because the race is more than 24 weeks away.',
    });
  }

  const phaseFor = (i) => (i <= phases.base ? 'base' : i <= phases.base + phases.build ? 'build' : 'peak');
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
      const hs = params.cls.taperHours;
      const vs = params.cls.taperVert;
      w.targetHours = round025(peakH * hs[Math.min(t, hs.length - 1)]);
      w.targetVertM = round50(peakV * vs[Math.min(t, vs.length - 1)]);
    } else {
      w.targetKm = Math.round(peakKm * params.table.taper[t]);
    }
    w.reason = t === taperWeeks - 1 ? 'Race week: volume excludes the race itself.' : 'Taper: reduced volume, short sharp sessions.';
    weeks.push(w);
  }
  return { weeks, phases, holdWeeks: hold, peakKm, peakHours: peakH, peakVertM: peakV };
}
