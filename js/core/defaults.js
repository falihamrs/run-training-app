import { nextMonday, WEEKDAYS } from './dates.js';
import { emptyCorosZones } from './zones.js';

export const SETTINGS_VERSION = 1;

export const EXPERIENCE_LEVELS = ['new', 'intermediate', 'experienced'];
export const TECHNICALITY_LEVELS = ['easy', 'moderate', 'technical'];
export const TERRAIN_TYPES = ['flat', 'hills', 'incline'];

export function defaultSettings(today) {
  return {
    version: SETTINGS_VERSION,
    athlete: { experience: 'intermediate', units: 'km' },
    race: {
      mode: 'trail',
      date: null,
      distanceKm: null,
      elevationGainM: 0,
      elevationLossM: null, // empty means "same as gain"
      technicality: 'moderate',
      cutoffSec: null,
      goalTimeSec: null,
    },
    schedule: {
      startDate: nextMonday(today),
      runsPerWeek: 5,
      longRunDay: 'Sun',
      unavailableDays: [],
      dayTerrain: Object.fromEntries(WEEKDAYS.map((d) => [d, 'flat'])),
      strengthSessions: null, // empty means the mode's default: 2 for trail, 1 for road
    },
    thresholds: [],
    corosZones: emptyCorosZones(),
  };
}

export function effectiveStrengthSessions(settings) {
  const n = settings.schedule.strengthSessions;
  if (n != null) return n;
  return settings.race.mode === 'trail' ? 2 : 1;
}
