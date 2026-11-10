// Manual climbing for runs whose file has no usable elevation (treadmill, bad barometer).
// The run is cut into 1 km splits; each split gets a treadmill incline (%) or metres of climbing.
import { terrainLabel } from './analyze.js';

export const MAX_INCLINE_PCT = 25;
export const MAX_SPLIT_GAIN_M = 400;
const SPLIT_M = 1000;
const MIN_LAST_SPLIT_M = 100;

/**
 * 1 km splits of a run. With the stored stream (5-second samples) each split has its real time and
 * heart rate; without it (a restored backup) the run's average pace is used.
 * @returns {{n:number,startM:number,distM:number,startSec:number,sec:number,avgHr:number|null}[]}
 */
export function kmSplits(run, stream = null) {
  const total = run.distanceKm * 1000;
  const bounds = [];
  for (let m = SPLIT_M; m < total; m += SPLIT_M) bounds.push(m);
  if (bounds.length && total - bounds[bounds.length - 1] < MIN_LAST_SPLIT_M) bounds.pop(); // fold a tiny tail into the last split
  bounds.push(total);

  const hasStream = stream?.t?.length > 1 && stream.d?.length === stream.t.length;
  // time (moving seconds) at which a distance is reached
  const timeAt = (m) => {
    if (!hasStream) return (m / total) * run.movingSec;
    const { t, d } = stream;
    if (m <= d[0]) return d[0] > 0 ? (m / d[0]) * t[0] : 0;
    for (let i = 1; i < d.length; i++) {
      if (d[i] >= m) {
        const span = d[i] - d[i - 1];
        return span > 0 ? t[i - 1] + ((m - d[i - 1]) / span) * (t[i] - t[i - 1]) : t[i];
      }
    }
    return run.movingSec;
  };
  const hrBetween = (s0, s1) => {
    if (!hasStream || !stream.hr) return null;
    let sum = 0, c = 0, n = 0;
    for (let i = 0; i < stream.t.length; i++) {
      if (stream.t[i] <= s0 || stream.t[i] > s1) continue;
      n++;
      if (stream.hr[i] != null) { sum += stream.hr[i]; c++; }
    }
    return n > 0 && c >= n * 0.8 ? sum / c : null;
  };

  const splits = [];
  let startM = 0;
  let startSec = 0;
  bounds.forEach((endM, i) => {
    const endSec = i === bounds.length - 1 ? run.movingSec : timeAt(endM);
    splits.push({ n: i + 1, startM, distM: endM - startM, startSec, sec: Math.max(0, endSec - startSec), avgHr: hrBetween(startSec, endSec) });
    startM = endM;
    startSec = endSec;
  });
  return splits;
}

/** Metres climbed in each split for the typed values. Empty or invalid values count as zero. */
export function splitGains(splits, values, unit) {
  return splits.map((s, i) => {
    const v = Number(values[i]);
    if (!Number.isFinite(v) || v <= 0) return 0;
    return unit === 'pct' ? (s.distM * Math.min(v, MAX_INCLINE_PCT)) / 100 : Math.min(v, MAX_SPLIT_GAIN_M);
  });
}

export function validateSplitValues(values, unit) {
  const max = unit === 'pct' ? MAX_INCLINE_PCT : MAX_SPLIT_GAIN_M;
  for (const raw of values) {
    if (raw === '' || raw == null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) return 'Use numbers of zero or more.';
    if (v > max) return unit === 'pct' ? `Incline cannot be above ${MAX_INCLINE_PCT}%.` : `One split cannot climb more than ${MAX_SPLIT_GAIN_M} m.`;
  }
  return null;
}

// climbing between two moments of the run, spreading each split's gain evenly over its time
function gainBetween(splits, gains, s0, s1) {
  let g = 0;
  splits.forEach((s, i) => {
    const a = Math.max(s0, s.startSec);
    const b = Math.min(s1, s.startSec + s.sec);
    if (b > a && s.sec > 0) g += gains[i] * ((b - a) / s.sec);
  });
  return g;
}

// Sustained climbs (>= 8 min at >= 6 %), the same rule the file analysis uses.
function climbsFrom(splits, gains) {
  const climbs = [];
  let block = null;
  const close = () => {
    if (block && block.durSec >= 480) {
      climbs.push({
        startSec: Math.round(block.startSec), durSec: Math.round(block.durSec), distM: block.distM, gainM: block.gainM,
        gradePct: (block.gainM / block.distM) * 100,
        avgHr: block.hrSec >= block.durSec * 0.8 ? block.hrSum / block.hrSec : null,
        climbSpeedMh: (block.gainM / block.durSec) * 3600,
      });
    }
    block = null;
  };
  splits.forEach((s, i) => {
    const grade = s.distM > 0 ? (gains[i] / s.distM) * 100 : 0;
    if (grade < 6) return close();
    block ??= { startSec: s.startSec, durSec: 0, distM: 0, gainM: 0, hrSum: 0, hrSec: 0 };
    block.durSec += s.sec;
    block.distM += s.distM;
    block.gainM += gains[i];
    if (s.avgHr != null) { block.hrSum += s.avgHr * s.sec; block.hrSec += s.sec; }
  });
  close();
  return climbs;
}

// Best flat pace window from the stream, skipping windows that climb (>= 10 m per km).
function bestFlatPace(stream, splits, gains, W) {
  if (!(stream?.t?.length > 1)) return undefined; // unknown without the stream
  const { t, d } = stream;
  let best = null;
  let j = 0;
  for (let i = 0; i < t.length; i++) {
    while (j < t.length && t[j] - t[i] < W) j++;
    if (j >= t.length) break;
    const dist = d[j] - d[i];
    if (dist <= 0) continue;
    const density = gainBetween(splits, gains, t[i], t[j]) / (dist / 1000);
    const pace = ((t[j] - t[i]) / dist) * 1000;
    if (density < 10 && (!best || pace < best.paceSecPerKm)) {
      let sum = 0, c = 0;
      for (let k = i + 1; k <= j; k++) if (stream.hr?.[k] != null) { sum += stream.hr[k]; c++; }
      best = { paceSecPerKm: pace, avgHr: c >= (j - i) * 0.9 ? sum / c : null, startSec: t[i] };
    }
  }
  return best;
}

function effortsWith(run, stream, splits, gains) {
  const out = {};
  for (const [key, W] of [['w20', 1200], ['w30', 1800]]) {
    const e = run.efforts?.[key];
    if (!e) { out[key] = e ?? null; continue; }
    let hard = e.hard;
    if (hard) {
      const dist = (W / hard.paceSecPerKm) * 1000;
      const g = gainBetween(splits, gains, hard.startSec, hard.startSec + W);
      hard = { ...hard, gradePct: dist > 0 ? (g / dist) * 100 : 0, climbDensity: dist > 0 ? g / (dist / 1000) : 0 };
    }
    let bestPace = e.bestPace;
    const fresh = bestFlatPace(stream, splits, gains, W);
    if (fresh !== undefined) {
      bestPace = fresh && e.bestPace && Math.abs(fresh.startSec - e.bestPace.startSec) <= 10 ? e.bestPace : fresh;
    } else if (bestPace) {
      // no stream: keep the window only if it did not climb
      const dist = (W / bestPace.paceSecPerKm) * 1000;
      if (gainBetween(splits, gains, bestPace.startSec, bestPace.startSec + W) / (dist / 1000) >= 10) bestPace = null;
    }
    out[key] = { ...e, hard, bestPace };
  }
  return out;
}

/** What the watch file gave, kept so manual climbing can be changed or removed later. */
function deviceValues(run) {
  return run.manualClimb?.device ?? { gainM: run.gainM, climbDensity: run.climbDensity, terrain: run.terrain, climbs: run.climbs ?? [], efforts: run.efforts ?? null };
}

/**
 * Fields to store on the run for the typed split values. `unit` is 'pct' (treadmill incline) or 'm'.
 * The original values from the file are kept under manualClimb.device.
 */
export function manualClimbPatch(run, stream, values, unit) {
  const splits = kmSplits(run, stream);
  const gains = splitGains(splits, values, unit);
  const gainM = gains.reduce((a, b) => a + b, 0);
  const device = deviceValues(run);
  const base = { ...run, efforts: device.efforts };
  const climbDensity = gainM / run.distanceKm;
  return {
    gainM,
    climbDensity,
    terrain: terrainLabel(climbDensity),
    climbs: climbsFrom(splits, gains),
    efforts: effortsWith(base, stream, splits, gains),
    manualClimb: { unit, values: splits.map((_, i) => { const v = Number(values[i]); return Number.isFinite(v) && v > 0 ? v : 0; }), device },
  };
}

/** Fields that put the run back to what the file said. */
export function clearManualClimbPatch(run) {
  const d = run.manualClimb?.device;
  if (!d) return null;
  return { gainM: d.gainM, climbDensity: d.climbDensity, terrain: d.terrain, climbs: d.climbs, efforts: d.efforts, manualClimb: null };
}
