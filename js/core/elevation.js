/** 5-sample running median. */
export function medianSmooth(values, win = 5) {
  const h = Math.floor(win / 2);
  return values.map((_, i) => {
    const s = values.slice(Math.max(0, i - h), i + h + 1).filter((v) => v != null).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  });
}

/**
 * Cumulative gain/loss after median smoothing, ignoring movement under a 3 m hysteresis.
 * Returns arrays aligned with the input (null altitudes carry the previous value).
 */
export function elevationProfile(alts, hysteresis = 3) {
  const filled = [];
  let last = null;
  for (const a of alts) {
    if (a != null) last = a;
    filled.push(last);
  }
  const sm = medianSmooth(filled);
  const gain = new Array(sm.length).fill(0);
  const loss = new Array(sm.length).fill(0);
  let ref = sm.find((v) => v != null);
  let g = 0;
  let l = 0;
  for (let i = 0; i < sm.length; i++) {
    const v = sm[i];
    if (v != null && ref != null) {
      if (v - ref >= hysteresis) { g += v - ref; ref = v; }
      else if (ref - v >= hysteresis) { l += ref - v; ref = v; }
    }
    gain[i] = g;
    loss[i] = l;
  }
  return { smoothed: sm, gain, loss };
}
