// Intensity zones. Workouts store zone ids; targets are resolved from the threshold
// entry in force on a given date. Percentages follow common running models and are
// editable; zones entered from the Coros app (bpm / pace) take priority when enabled.

// Pace factors multiply threshold pace (seconds per km): below 1 is faster.
// "fast" is the smaller factor; null means open-ended.
const ROAD_ZONES = [
  { id: 'Z1', name: 'Recovery', hrGroup: 'Z1', lthr: [null, 0.85], pace: { fast: 1.29, slow: null } },
  { id: 'Z2', name: 'Easy, long run', hrGroup: 'Z2', lthr: [0.85, 0.89], pace: { fast: 1.14, slow: 1.29 } },
  { id: 'Z3', name: 'Steady', hrGroup: 'Z3', lthr: [0.9, 0.94], pace: { fast: 1.06, slow: 1.13 } },
  { id: 'Z4', name: 'Threshold', hrGroup: 'Z4', lthr: [0.95, 0.99], pace: { fast: 0.99, slow: 1.05 } },
  { id: 'Z5a', name: 'Fast threshold', hrGroup: 'Z5', lthr: [1.0, 1.02], pace: { fast: 0.97, slow: 0.98 } },
  { id: 'Z5b', name: 'VO2 intervals', hrGroup: 'Z5', lthr: [1.03, 1.06], pace: { fast: 0.9, slow: 0.96 } },
  { id: 'Z5c', name: 'Short repetitions', hrGroup: 'Z5', lthr: [1.06, null], pace: { fast: null, slow: 0.9 } },
];

// Trail mode: five heart-rate zones with effort ratings. Pace is shown only for
// flat segments, so the Z5 row has none.
const TRAIL_ZONES = [
  { id: 'Z1', name: 'Recovery', hrGroup: 'Z1', lthr: [null, 0.85], pace: { fast: 1.29, slow: null }, rpe: '1–2' },
  { id: 'Z2', name: 'Easy', hrGroup: 'Z2', lthr: [0.85, 0.89], pace: { fast: 1.14, slow: 1.29 }, rpe: '3–4' },
  { id: 'Z3', name: 'Steady', hrGroup: 'Z3', lthr: [0.9, 0.94], pace: { fast: 1.06, slow: 1.13 }, rpe: '5' },
  { id: 'Z4', name: 'Threshold', hrGroup: 'Z4', lthr: [0.95, 0.99], pace: { fast: 0.99, slow: 1.05 }, rpe: '6–7' },
  { id: 'Z5', name: 'Hard', hrGroup: 'Z5', lthr: [1.0, null], pace: null, rpe: '8–10' },
];

export const HR_GROUPS = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
export const COROS_PACE_ZONES = ['Z1', 'Z2', 'Z3', 'Z4'];

export function zoneIds(mode) {
  return (mode === 'trail' ? TRAIL_ZONES : ROAD_ZONES).map((z) => z.id);
}

const scale = (factor, base) => (factor == null ? null : Math.round(factor * base));

/**
 * Resolve every zone to concrete heart-rate (bpm) and pace (sec/km) ranges.
 * `coros` is { enabled, hr: { Z1..Z5: [lo, hi] }, pace: { Z1..Z4: [fast, slow] } }.
 * Range ends that are null are open (for example Z1 has no lower bound).
 */
export function resolveZones({ mode = 'road', lthr = null, paceSecPerKm = null, coros = null } = {}) {
  const useCoros = Boolean(coros && coros.enabled);
  const defs = mode === 'trail' ? TRAIL_ZONES : ROAD_ZONES;

  return defs.map((def) => {
    let hr = null;
    let hrSource = null;
    const corosHr = useCoros ? coros.hr?.[def.hrGroup] : null;
    if (corosHr) {
      hr = { lo: corosHr[0] ?? null, hi: corosHr[1] ?? null };
      hrSource = 'coros';
    } else if (lthr != null) {
      hr = { lo: scale(def.lthr[0], lthr), hi: scale(def.lthr[1], lthr) };
      hrSource = 'percent';
    }

    let pace = null;
    let paceSource = null;
    const corosPace = useCoros ? coros.pace?.[def.id] : null;
    if (corosPace) {
      pace = { fast: corosPace[0] ?? null, slow: corosPace[1] ?? null };
      paceSource = 'coros';
    } else if (paceSecPerKm != null && def.pace) {
      pace = { fast: scale(def.pace.fast, paceSecPerKm), slow: scale(def.pace.slow, paceSecPerKm) };
      paceSource = 'percent';
    }

    return {
      id: def.id,
      name: def.name,
      rpe: def.rpe ?? null,
      hr,
      hrSource,
      pace,
      paceSource,
      flatOnly: mode === 'trail' && pace != null,
    };
  });
}

/** "143–150 bpm", "below 143 bpm", "above 178 bpm", or "–" when unknown. */
export function formatHrRange(hr) {
  if (!hr) return '–';
  if (hr.lo == null && hr.hi == null) return '–';
  if (hr.lo == null) return `below ${hr.hi} bpm`;
  if (hr.hi == null) return `above ${hr.lo} bpm`;
  return `${hr.lo}–${hr.hi} bpm`;
}

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** "6:16–7:06 /km", "slower than 7:06 /km", "faster than 4:57 /km", or "–". */
export function formatPaceRange(pace) {
  if (!pace) return '–';
  const { fast, slow } = pace;
  if (fast == null && slow == null) return '–';
  if (slow == null) return `slower than ${mmss(fast)} /km`;
  if (fast == null) return `faster than ${mmss(slow)} /km`;
  return `${mmss(fast)}–${mmss(slow)} /km`;
}

/** An empty set of zones entered from Coros. */
export function emptyCorosZones() {
  return { enabled: false, hr: {}, pace: {} };
}

/**
 * Check zones typed in from the Coros app. Returns a list of { field, message }.
 * Heart-rate zones Z1–Z5 are required when enabled; Z1 may have no lower bound
 * and Z5 no upper bound. Pace zones Z1–Z4 are optional, all or nothing.
 */
export function validateCorosZones(coros) {
  const errors = [];
  if (!coros || !coros.enabled) return errors;

  let prevHi = null;
  for (const g of HR_GROUPS) {
    const z = coros.hr?.[g];
    const field = `corosZones.hr.${g}`;
    if (!z) {
      errors.push({ field, message: `Heart-rate zone ${g} is missing.` });
      continue;
    }
    const [lo, hi] = z;
    const needsLo = g !== 'Z1';
    const needsHi = g !== 'Z5';
    if ((needsLo && !Number.isFinite(lo)) || (needsHi && !Number.isFinite(hi))) {
      errors.push({ field, message: `Heart-rate zone ${g} needs ${needsLo && needsHi ? 'both ends' : needsLo ? 'a lower bound' : 'an upper bound'}.` });
      continue;
    }
    const nums = [lo, hi].filter(Number.isFinite);
    if (nums.some((n) => n < 30 || n > 230)) {
      errors.push({ field, message: `Heart-rate zone ${g} must be between 30 and 230 bpm.` });
      continue;
    }
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo >= hi) {
      errors.push({ field, message: `Heart-rate zone ${g}: the lower bound must be below the upper bound.` });
      continue;
    }
    if (prevHi != null && Number.isFinite(lo) && lo < prevHi) {
      errors.push({ field, message: `Heart-rate zone ${g} overlaps the zone below it.` });
    }
    if (Number.isFinite(hi)) prevHi = hi;
  }

  const paceGiven = COROS_PACE_ZONES.filter((g) => coros.pace?.[g]);
  if (paceGiven.length > 0 && paceGiven.length < COROS_PACE_ZONES.length) {
    errors.push({ field: 'corosZones.pace', message: 'Enter pace zones Z1–Z4 completely, or leave them all empty.' });
  } else if (paceGiven.length === COROS_PACE_ZONES.length) {
    let prevFast = null;
    for (const g of COROS_PACE_ZONES) {
      const [fast, slow] = coros.pace[g];
      const field = `corosZones.pace.${g}`;
      const slowOpen = g === 'Z1';
      if (!Number.isFinite(fast) || (!slowOpen && !Number.isFinite(slow))) {
        errors.push({ field, message: `Pace zone ${g} needs ${slowOpen ? 'a faster limit' : 'both limits'} as m:ss.` });
        continue;
      }
      if (Number.isFinite(slow) && fast >= slow) {
        errors.push({ field, message: `Pace zone ${g}: the faster limit must be quicker than the slower limit.` });
        continue;
      }
      if (prevFast != null && Number.isFinite(slow) && slow > prevFast) {
        errors.push({ field, message: `Pace zone ${g} overlaps the zone below it.` });
      }
      prevFast = fast;
    }
  }
  return errors;
}
