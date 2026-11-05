// Race sizing for trail mode (section 3 and 4 of the spec).

/** Distance in km plus 1 km for every 100 m climbed. */
export function kmEffort(distanceKm, gainM) {
  return distanceKm + (gainM ?? 0) / 100;
}

/** Metres of climbing per km of distance. */
export function climbDensity(distanceKm, gainM) {
  return distanceKm > 0 ? (gainM ?? 0) / distanceKm : 0;
}
