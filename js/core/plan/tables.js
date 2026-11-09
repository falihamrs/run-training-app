// Reference tables and small helpers for the plan generator (spec sections 4 to 6).

export const RIEGEL = 1.06;

export const round025 = (h) => Math.round(h * 4) / 4;
export const round50 = (m) => Math.round(m / 50) * 50;
export const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);

/** Road race categories. peakKm and peakLong are [new, intermediate, experienced]. */
export const ROAD_TABLE = {
  '5k': { label: '5 km', block: 4, rec: 8, peakKm: [25, 35, 50], peakLong: [10, 12, 14], taper: [0.6], entry: null, entryBlock: false },
  '10k': { label: '10 km', block: 6, rec: 10, peakKm: [30, 40, 60], peakLong: [12, 16, 18], taper: [0.6], entry: [10, 5], entryBlock: false },
  half: { label: 'half marathon', block: 8, rec: 12, peakKm: [35, 50, 70], peakLong: [16, 19, 22], taper: [0.75, 0.5], entry: [15, 8], entryBlock: true },
  marathon: { label: 'marathon', block: 12, rec: 16, peakKm: [45, 65, 90], peakLong: [28, 32, 32], taper: [0.8, 0.6, 0.35], entry: [25, 10], entryBlock: true },
};

export function roadCategory(distanceKm) {
  if (distanceKm <= 7.5) return '5k';
  if (distanceKm <= 15) return '10k';
  if (distanceKm <= 30) return 'half';
  return 'marathon';
}

/** Trail race size classes by km-effort. */
export const TRAIL_TABLE = [
  { max: 25, label: 'up to 25 km-effort', block: 6, rec: 10, taperHours: [0.6], taperVert: [0.4], entry: null },
  { max: 45, label: '25 to 45 km-effort', block: 8, rec: 12, taperHours: [0.75, 0.5], taperVert: [0.6, 0.3], entry: [3, 1.5] },
  { max: 75, label: '45 to 75 km-effort', block: 12, rec: 16, taperHours: [0.75, 0.5], taperVert: [0.6, 0.3], entry: [4, 2] },
];

export function trailClass(effort) {
  return TRAIL_TABLE.find((c) => effort <= c.max) ?? null;
}

export const EXPERIENCE_INDEX = { new: 0, intermediate: 1, experienced: 2 };
export const TRAIL_MIN_PER_EFFORT_KM = [7.5, 6.5, 5.5];
export const TRAIL_PEAK_HOURS_MULT = [1.0, 1.2, 1.4];
export const TRAIL_PEAK_HOURS_CAP = [7, 9, 12];
export const TRAIL_PEAK_VERT_SHARE = [0.55, 0.7, 0.8];
export const TRAIL_LONG_CAP_H = [3.5, 4.5, 5.5];
export const ROAD_RAMP = [0.08, 0.1, 0.1];
export const TRAIL_RAMP = [0.08, 0.1, 0.1];

/** Predicted race time (seconds) from threshold pace T (s/km), treating T as one-hour race pace. */
export function predictRoadTime(thresholdPaceSecPerKm, distanceKm) {
  const oneHourKm = 3600 / thresholdPaceSecPerKm;
  return Math.round(3600 * Math.pow(distanceKm / oneHourKm, RIEGEL));
}
