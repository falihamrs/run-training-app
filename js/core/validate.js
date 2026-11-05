// Validation of the settings object, following section 2 of the spec.
// Returns errors (block saving) and warnings (shown, but allowed).

import { WEEKDAYS, isValidDate, mondayOnOrBefore, weekdayOf } from './dates.js';
import { EXPERIENCE_LEVELS, TECHNICALITY_LEVELS, TERRAIN_TYPES } from './defaults.js';
import { validateThresholdEntry } from './thresholds.js';
import { validateCorosZones } from './zones.js';

const ROAD_DISTANCE = [3, 50];
const TRAIL_DISTANCE = [10, 45];
const MAX_CLIMB_PER_KM = 100;

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

export function validateSettings(s, { today } = {}) {
  const errors = [];
  const warnings = [];
  const err = (field, message) => errors.push({ field, message });
  const warn = (field, message) => warnings.push({ field, message });

  const { athlete, race, schedule } = s;
  const trail = race.mode === 'trail';

  if (!EXPERIENCE_LEVELS.includes(athlete.experience)) err('athlete.experience', 'Choose an experience level.');

  // Race
  if (race.mode !== 'road' && race.mode !== 'trail') err('race.mode', 'Choose road or trail.');
  if (!isValidDate(race.date)) err('race.date', 'Enter the race date.');
  else if (today && race.date <= today) err('race.date', 'The race date must be in the future.');

  const [dMin, dMax] = trail ? TRAIL_DISTANCE : ROAD_DISTANCE;
  if (!isNum(race.distanceKm)) err('race.distanceKm', 'Enter the race distance in km.');
  else if (race.distanceKm < dMin || race.distanceKm > dMax) {
    err('race.distanceKm', `${trail ? 'Trail' : 'Road'} distance must be between ${dMin} and ${dMax} km.`);
  }

  if (trail) {
    if (!isNum(race.elevationGainM) || race.elevationGainM < 0) {
      err('race.elevationGainM', 'Enter the race elevation gain in metres (0 or more).');
    } else if (isNum(race.distanceKm) && race.elevationGainM > MAX_CLIMB_PER_KM * race.distanceKm) {
      err('race.elevationGainM', `Elevation gain is above ${MAX_CLIMB_PER_KM} m per km of distance. Check the figure.`);
    }
    if (race.elevationLossM != null && (!isNum(race.elevationLossM) || race.elevationLossM < 0)) {
      err('race.elevationLossM', 'Elevation loss must be 0 or more, or left empty.');
    }
    if (!TECHNICALITY_LEVELS.includes(race.technicality)) err('race.technicality', 'Choose easy, moderate or technical.');
  }
  for (const [field, label] of [['cutoffSec', 'Cut-off time'], ['goalTimeSec', 'Goal time']]) {
    const v = race[field];
    if (v != null && (!isNum(v) || v <= 0)) err(`race.${field}`, `${label} must be a duration like 7:30:00, or left empty.`);
  }
  if (isNum(race.goalTimeSec) && isNum(race.cutoffSec) && race.goalTimeSec >= race.cutoffSec) {
    warn('race.goalTimeSec', 'Goal time is not faster than the cut-off time.');
  }

  // Schedule
  let startDate = schedule.startDate;
  if (!isValidDate(startDate)) {
    err('schedule.startDate', 'Enter the plan start date.');
    startDate = null;
  } else {
    if (weekdayOf(startDate) !== 'Mon') {
      warn('schedule.startDate', `The plan will start on Monday ${mondayOnOrBefore(startDate)}, the Monday on or before your date.`);
    }
    if (today && mondayOnOrBefore(startDate) < mondayOnOrBefore(today)) {
      warn('schedule.startDate', 'The start date is in a past week.');
    }
    if (isValidDate(race.date) && race.date <= startDate) {
      err('race.date', 'The race date must be after the plan start date.');
    }
  }

  const unavailable = schedule.unavailableDays ?? [];
  const available = WEEKDAYS.filter((d) => !unavailable.includes(d));
  if (!Number.isInteger(schedule.runsPerWeek) || schedule.runsPerWeek < 3 || schedule.runsPerWeek > 7) {
    err('schedule.runsPerWeek', 'Runs per week must be between 3 and 7.');
  } else {
    if (schedule.runsPerWeek === 7) warn('schedule.runsPerWeek', 'Seven runs a week leaves no rest day and is not recommended.');
    if (available.length < 3) {
      err('schedule.unavailableDays', 'At least 3 days must stay available for running.');
    } else if (available.length < schedule.runsPerWeek) {
      warn('schedule.unavailableDays', `Only ${available.length} days are available, so the plan will use ${available.length} runs per week.`);
    }
  }

  if (!WEEKDAYS.includes(schedule.longRunDay)) err('schedule.longRunDay', 'Choose a long-run day.');
  else if (unavailable.includes(schedule.longRunDay)) err('schedule.longRunDay', 'The long-run day is marked unavailable.');
  else if (trail && schedule.dayTerrain?.[schedule.longRunDay] !== 'hills') {
    warn('schedule.longRunDay', 'In trail mode the long run belongs on a hills day. Set that day to "hills" or pick another day.');
  }

  for (const d of WEEKDAYS) {
    if (!TERRAIN_TYPES.includes(schedule.dayTerrain?.[d])) err(`schedule.dayTerrain.${d}`, `Choose flat, hills or incline for ${d}.`);
  }
  if (schedule.strengthSessions != null && ![0, 1, 2].includes(schedule.strengthSessions)) {
    err('schedule.strengthSessions', 'Strength sessions must be 0, 1 or 2, or left on the default.');
  }

  if (trail && isNum(race.elevationGainM) && race.elevationGainM >= 1000) {
    const terrains = available.map((d) => schedule.dayTerrain?.[d]);
    const hasHills = terrains.includes('hills');
    const hasIncline = terrains.includes('incline');
    if (!hasHills && !hasIncline) {
      warn('schedule.dayTerrain', 'No hills or incline day is available, so the weekly climbing target cannot be placed.');
    } else if (!hasHills) {
      warn('schedule.dayTerrain', 'No hills day is set, so all climbing must come from incline sessions.');
    }
  }

  // Thresholds
  for (const [i, e] of s.thresholds.entries()) {
    for (const message of validateThresholdEntry(e)) err(`thresholds.${i}`, message);
  }
  if (trail && !s.thresholds.some((e) => e.lthr != null)) {
    err('thresholds', 'Trail mode needs an LTHR. Add a threshold entry with LTHR.');
  }
  if (!trail && !s.thresholds.some((e) => e.paceSecPerKm != null)) {
    err('thresholds', 'Road mode needs a threshold pace. Add a threshold entry with pace.');
  }
  if (!trail && s.thresholds.length > 0 && !s.thresholds.some((e) => e.lthr != null)) {
    warn('thresholds', 'Without LTHR the road plan will use pace targets only.');
  }
  if (startDate && s.thresholds.length > 0) {
    const first = [...s.thresholds].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
    if (first.effectiveFrom > startDate) warn('thresholds', 'No threshold entry is in force on the plan start date.');
  }

  for (const e of validateCorosZones(s.corosZones)) err(e.field, e.message);

  const normalized = startDate
    ? { ...s, schedule: { ...schedule, startDate: mondayOnOrBefore(startDate) } }
    : s;
  return { errors, warnings, normalized, effectiveRunsPerWeek: Math.min(schedule.runsPerWeek, available.length) };
}
