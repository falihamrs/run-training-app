export const RIEGEL_EXPONENT = 1.06;

/** Predicted time (s) at targetKm from a known effort. */
export function riegelTime(timeSec, distKm, targetKm, exponent = RIEGEL_EXPONENT) {
  return timeSec * Math.pow(targetKm / distKm, exponent);
}

/** 10 km pace (s/km) equivalent of an effort. */
export function pace10kEquivalent(timeSec, distKm) {
  return riegelTime(timeSec, distKm, 10) / 10;
}

/** Pace (s/km) you could hold for one hour, from a race of distKm in timeSec. This is threshold pace. */
export function oneHourPace(timeSec, distKm, exponent = RIEGEL_EXPONENT) {
  const d60 = distKm * Math.pow(3600 / timeSec, 1 / exponent);
  return 3600 / d60;
}
