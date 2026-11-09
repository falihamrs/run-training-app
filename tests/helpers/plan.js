import { defaultSettings } from '../../js/core/defaults.js';
import { addDays } from '../../js/core/dates.js';

export const START = '2027-01-04'; // a Monday
export function settingsFor(o = {}) {
  const s = defaultSettings('2026-12-28');
  s.athlete.experience = o.experience ?? 'intermediate';
  s.race = { ...s.race, mode: o.mode ?? 'road', distanceKm: o.distanceKm ?? 42.195, elevationGainM: o.gain ?? 0, date: addDays(START, 7 * ((o.weeks ?? 16) - 1) + 6), goalTimeSec: o.goal ?? null, cutoffSec: null };
  s.schedule = { ...s.schedule, startDate: START, runsPerWeek: o.runs ?? 5, longRunDay: 'Sun', unavailableDays: o.unavailable ?? [], dayTerrain: o.terrain ?? s.schedule.dayTerrain };
  s.thresholds = o.thresholds ?? [{ effectiveFrom: START, lthr: o.lthr === undefined ? 168 : o.lthr, paceSecPerKm: o.pace === undefined ? 330 : o.pace, source: 'manual' }];
  return s;
}
export const hist = (o = {}) => ({ baselineWeeklyKm: 30, baselineWeeklyHours: 4, baselineWeeklyVertM: 400, longestRunKm: 14, longestRunMin: 150, returnFromBreak: false, easyPaceSecPerKm: 390, trailPaceMinPerKmEffort: null, ...o });

export const TERRAIN = { Mon: 'incline', Tue: 'flat', Wed: 'incline', Thu: 'flat', Fri: 'flat', Sat: 'hills', Sun: 'hills' };
