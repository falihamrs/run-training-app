// Turns one parsed activity into a run record plus a compact stream.
import { haversine } from './geo.js';
import { elevationProfile } from './elevation.js';
import { localDateOfMs } from './dates.js';

// Slower than 33:20/km (0.5 m/s), judged over about 10 seconds, counts as stopped. Steep power-hiking
// and walking recoveries stay moving; standing at a crossing does not.
export const SLOWEST_MOVING_SEC_PER_KM = 2000;
const STOP_WINDOW_SEC = 5; // seconds either side
const MAX_GAP_SEC = 10; // longer gaps in the file are pauses
const MIN_DIST_M = 1000;

export function terrainLabel(climbDensity) {
  if (climbDensity < 10) return 'flat';
  if (climbDensity <= 25) return 'rolling';
  return 'hilly';
}

function ensureDistance(points) {
  const out = points.map((p) => ({ ...p }));
  const hasDist = out.filter((p) => p.dist != null).length >= out.length * 0.9;
  if (hasDist) {
    let last = 0;
    for (const p of out) { if (p.dist == null) p.dist = last; else last = p.dist; }
    return out;
  }
  let cum = 0;
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    const q = out[i - 1];
    if (q && p.lat != null && q.lat != null) cum += haversine(q.lat, q.lon, p.lat, p.lon);
    p.dist = cum;
  }
  return out;
}

/** Build the 1 Hz moving timeline: cumulative distance, altitude, gain, heart rate. */
export function buildTimeline(rawPoints, { indoor = false } = {}) {
  const pts = ensureDistance(rawPoints);
  const prof = elevationProfile(pts.map((p) => p.alt));
  const d = [];
  const alt = [];
  const gain = [];
  const loss = [];
  const hr = [];
  let moved = 0;
  let elapsed = 0;
  // speed over a short window around each sample: watches write distance in whole metres every second,
  // so one second on its own (1 m = 16:40/km) says little about whether you stopped
  let lo = 0, hi = 0;
  const windowPace = (i) => {
    const t = pts[i].t;
    while (pts[lo].t < t - STOP_WINDOW_SEC * 1000) lo++;
    while (hi < pts.length - 1 && pts[hi + 1].t <= t + STOP_WINDOW_SEC * 1000) hi++;
    // never let the window reach across a pause in the recording
    let a = lo, b = hi;
    for (let k = i; k > a; k--) if (pts[k].t - pts[k - 1].t > MAX_GAP_SEC * 1000) { a = k; break; }
    for (let k = i; k < b; k++) if (pts[k + 1].t - pts[k].t > MAX_GAP_SEC * 1000) { b = k; break; }
    const dt = (pts[b].t - pts[a].t) / 1000;
    const dd = pts[b].dist - pts[a].dist;
    return dt > 0 && dd > 0 ? (dt / dd) * 1000 : Infinity;
  };
  let carry = 0; // distance covered while stopped, added to the next moving second so the total stays right
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) continue;
    elapsed += dt;
    const dd = b.dist - a.dist;
    if (dd < 0) continue;
    if (dt > MAX_GAP_SEC) { carry += dd; continue; } // a pause: keep the distance, not the time
    // indoors the distance comes from a wrist or foot sensor that updates in steps, so a still second is a
    // sensor step, not a stop; only gaps in the recording are pauses there
    if (!indoor && windowPace(i) > SLOWEST_MOVING_SEC_PER_KM) { carry += dd; continue; }
    const steps = Math.max(1, Math.round(dt));
    const step = (dd + carry) / steps;
    carry = 0;
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      moved += step;
      d.push(moved);
      alt.push(prof.smoothed[i - 1] == null ? null : prof.smoothed[i - 1] + (prof.smoothed[i] - prof.smoothed[i - 1]) * f);
      gain.push(prof.gain[i - 1] + (prof.gain[i] - prof.gain[i - 1]) * f);
      loss.push(prof.loss[i - 1] + (prof.loss[i] - prof.loss[i - 1]) * f);
      const h = b.hr != null && a.hr != null ? a.hr + (b.hr - a.hr) * f : b.hr ?? a.hr;
      hr.push(h != null && h >= 40 && h <= 220 ? h : null);
    }
  }
  if (carry > 0 && d.length) d[d.length - 1] = moved += carry; // distance after the last moving second
  return { d, alt, gain, loss, hr, elapsedSec: elapsed, totalGain: prof.gain.at(-1) ?? 0, totalLoss: prof.loss.at(-1) ?? 0 };
}

function windowStats(tl, i, W) {
  const j = i + W;
  const dist = tl.d[j - 1] - (i > 0 ? tl.d[i - 1] : 0);
  const g = tl.gain[j - 1] - (i > 0 ? tl.gain[i - 1] : 0);
  return { dist, gain: g };
}

/** Best flat-ish pace and hardest-HR window for one window length (seconds). */
export function windowEfforts(tl, W) {
  const n = tl.d.length;
  if (n < W) return null;
  const hrPrefix = [0];
  const hrCount = [0];
  for (let i = 0; i < n; i++) {
    hrPrefix.push(hrPrefix[i] + (tl.hr[i] ?? 0));
    hrCount.push(hrCount[i] + (tl.hr[i] != null ? 1 : 0));
  }
  let bestPace = null;
  let hard = null;
  for (let i = 0; i + W <= n; i += 5) {
    const { dist, gain } = windowStats(tl, i, W);
    if (dist <= 0) continue;
    const pace = (W / dist) * 1000;
    const density = gain / (dist / 1000);
    const cnt = hrCount[i + W] - hrCount[i];
    const avgHr = cnt >= W * 0.9 ? (hrPrefix[i + W] - hrPrefix[i]) / cnt : null;
    if (density < 10 && (!bestPace || pace < bestPace.paceSecPerKm)) {
      bestPace = { paceSecPerKm: pace, avgHr, startSec: i };
    }
    if (avgHr != null && (!hard || avgHr > hard.avgHr)) {
      hard = { avgHr, paceSecPerKm: pace, gradePct: ((tl.alt[i + W - 1] ?? 0) - (tl.alt[i] ?? 0)) / dist * 100, climbDensity: density, startSec: i };
    }
  }
  return { bestPace, hard };
}

/** Sustained climbs: >= 8 min and >= 6 % grade, found with a 10 m zigzag filter. */
export function findClimbs(tl) {
  const n = tl.alt.length;
  if (n < 2) return [];
  const ZZ = 10;
  const climbs = [];
  let lowIdx = 0;
  let highIdx = 0;
  let dir = 0; // 1 rising, -1 falling
  const close = (s, e) => {
    const dur = e - s;
    const dist = tl.d[e] - tl.d[s];
    const rise = (tl.alt[e] ?? 0) - (tl.alt[s] ?? 0);
    if (dur >= 480 && dist > 0 && (rise / dist) * 100 >= 6) {
      let sum = 0, c = 0;
      for (let k = s; k <= e; k++) if (tl.hr[k] != null) { sum += tl.hr[k]; c++; }
      climbs.push({
        startSec: s, durSec: dur, distM: dist, gainM: rise, gradePct: (rise / dist) * 100,
        avgHr: c >= dur * 0.8 ? sum / c : null, climbSpeedMh: (rise / dur) * 3600,
      });
    }
  };
  for (let i = 1; i < n; i++) {
    const a = tl.alt[i];
    if (a == null) continue;
    if (dir >= 0 && a > (tl.alt[highIdx] ?? -Infinity)) highIdx = i;
    if (dir <= 0 && a <= (tl.alt[lowIdx] ?? Infinity)) lowIdx = i;
    if (dir <= 0 && a - tl.alt[lowIdx] >= ZZ) { dir = 1; highIdx = i; }
    else if (dir >= 0 && tl.alt[highIdx] - a >= ZZ) {
      if (dir === 1) close(lowIdx, highIdx);
      dir = -1; lowIdx = i;
    }
  }
  if (dir === 1) close(lowIdx, highIdx);
  return climbs;
}

/**
 * The watch's laps as distances along the run, scaled to the analysed distance. Laps shorter than
 * 20 m (a lap button pressed twice) join the next one. Null when the file has fewer than two laps.
 */
function lapsOf(act, totalM) {
  const raw = (act.laps ?? []).filter((l) => l.distM >= 0 && l.sec >= 0);
  if (raw.length < 2) return null;
  const merged = [];
  let carry = null;
  for (const l of raw) {
    const cur = carry ? { distM: carry.distM + l.distM, sec: carry.sec + l.sec } : { distM: l.distM, sec: l.sec };
    if (cur.distM < 20) { carry = cur; continue; }
    carry = null;
    merged.push(cur);
  }
  if (carry && merged.length) { merged.at(-1).distM += carry.distM; merged.at(-1).sec += carry.sec; }
  const sum = merged.reduce((s, l) => s + l.distM, 0);
  if (merged.length < 2 || sum <= 0) return null;
  const k = totalM / sum;
  return merged.map((l) => ({ distM: Math.round(l.distM * k * 10) / 10, sec: Math.round(l.sec) }));
}

/**
 * @returns {{ok:true,run:object,stream:object}|{ok:false,error:string}}
 */
export function analyzeActivity(act, { tzOffsetMin = 0, fileName = '' } = {}) {
  if (!act.points || act.points.length < 30) return { ok: false, error: 'Too few data points' };
  // no position anywhere in the file: a treadmill or other indoor run
  const indoor = !act.points.some((p) => p.lat != null && p.lon != null);
  const tl = buildTimeline(act.points, { indoor });
  const dist = tl.d.at(-1) ?? 0;
  if (dist <= 0) return { ok: false, error: 'No distance in file' };
  if (dist < MIN_DIST_M) return { ok: false, error: 'Shorter than 1 km' };

  const movingSec = tl.d.length;
  const hrs = tl.hr.filter((h) => h != null);
  const distKm = dist / 1000;
  const density = tl.totalGain / distKm;
  const e20 = windowEfforts(tl, 1200);
  const e30 = windowEfforts(tl, 1800);
  const run = {
    date: localDateOfMs(act.startTime, tzOffsetMin),
    startTime: act.startTime,
    sport: act.sport,
    fileName,
    distanceKm: distKm,
    movingSec,
    elapsedSec: Math.round(tl.elapsedSec),
    avgPaceSecPerKm: movingSec / distKm,
    avgHr: hrs.length >= movingSec * 0.5 ? hrs.reduce((s, h) => s + h, 0) / hrs.length : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    gainM: tl.totalGain,
    lossM: tl.totalLoss,
    climbDensity: density,
    terrain: terrainLabel(density),
    efforts: { w20: e20, w30: e30 },
    climbs: findClimbs(tl),
    race: false,
    indoor,
    laps: lapsOf(act, dist),
    fingerprint: `${act.startTime}|${Math.round(dist)}`,
  };
  // 5-second downsample for later charts
  const stream = { t: [], d: [], alt: [], hr: [] };
  for (let i = 4; i < tl.d.length; i += 5) {
    stream.t.push(i + 1);
    stream.d.push(Math.round(tl.d[i]));
    stream.alt.push(tl.alt[i] == null ? null : Math.round(tl.alt[i] * 10) / 10);
    stream.hr.push(tl.hr[i] == null ? null : Math.round(tl.hr[i]));
  }
  return { ok: true, run, stream };
}
