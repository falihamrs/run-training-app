export const RIEGEL_EXPONENT = 1.06;

/** Predicted time (s) at targetKm from a known effort. */
export function riegelTime(timeSec, distKm, targetKm, exponent = RIEGEL_EXPONENT) {
  return timeSec * Math.pow(targetKm / distKm, exponent);
}

/** 10 km pace (s/km) equivalent of an effort. */
export function pace10kEquivalent(timeSec, distKm) {
  return riegelTime(timeSec, distKm, 10) / 10;
}
