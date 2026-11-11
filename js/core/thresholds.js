// Threshold history: an append-only list. A workout always resolves against the entry
// in force on its date, so updating thresholds never rewrites the past.

import { isValidDate, addDays } from './dates.js';

export const LTHR_RANGE = [120, 200];
export const PACE_RANGE = [150, 540]; // seconds per km (2:30 to 9:00)
export const SOURCES = ['manual', 'suggested', 'test', 'ai'];

export function sortThresholds(list) {
  return [...list].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
}

/** The entry in force on `date`: the last one whose effectiveFrom is on or before it. */
export function thresholdForDate(list, date) {
  let found = null;
  for (const e of sortThresholds(list)) {
    if (e.effectiveFrom <= date) found = e;
  }
  return found;
}

/** The entry to show when no entry is in force yet: the earliest one. */
export function earliestThreshold(list) {
  const sorted = sortThresholds(list);
  return sorted.length > 0 ? sorted[0] : null;
}

/** Validate one entry; returns a list of error messages. */
export function validateThresholdEntry(entry) {
  const errors = [];
  if (!isValidDate(entry.effectiveFrom)) errors.push('Choose a valid effective date.');
  const { lthr, paceSecPerKm } = entry;
  if (lthr == null && paceSecPerKm == null) errors.push('Enter LTHR, threshold pace, or both.');
  if (lthr != null && (!Number.isFinite(lthr) || lthr < LTHR_RANGE[0] || lthr > LTHR_RANGE[1])) {
    errors.push(`LTHR must be between ${LTHR_RANGE[0]} and ${LTHR_RANGE[1]} bpm.`);
  }
  if (paceSecPerKm != null && (!Number.isFinite(paceSecPerKm) || paceSecPerKm < PACE_RANGE[0] || paceSecPerKm > PACE_RANGE[1])) {
    errors.push('Threshold pace must be between 2:30 and 9:00 per km.');
  }
  if (entry.source && !SOURCES.includes(entry.source)) errors.push('Unknown source.');
  return errors;
}

/**
 * Append an entry. Dates before `today` are refused (except for the very first
 * entry), and an entry on an existing date replaces that entry.
 * Returns { list, errors }; `list` is unchanged when there are errors.
 */
export function addThresholdEntry(list, entry, today) {
  const errors = validateThresholdEntry(entry);
  // A new entry cannot start in the past, but an existing entry can be corrected by adding one with
  // the same date (a typing mistake in the first entry would otherwise be stuck for good).
  const correction = list.some((e) => e.effectiveFrom === entry.effectiveFrom);
  if (errors.length === 0 && list.length > 0 && entry.effectiveFrom < today && !correction) {
    errors.push('A new entry cannot start in the past, so earlier workouts keep their old targets. To correct an existing entry, use its exact date.');
  }
  if (errors.length > 0) return { list, errors };
  // An entry that updates only one value keeps the other from the entry in force before it,
  // otherwise a pace-only update would silently remove the heart-rate targets (and the other way round).
  const prev = thresholdForDate(list.filter((e) => e.effectiveFrom !== entry.effectiveFrom), entry.effectiveFrom);
  const clean = {
    effectiveFrom: entry.effectiveFrom,
    lthr: entry.lthr ?? prev?.lthr ?? null,
    paceSecPerKm: entry.paceSecPerKm ?? prev?.paceSecPerKm ?? null,
    source: entry.source ?? 'manual',
  };
  const without = list.filter((e) => e.effectiveFrom !== clean.effectiveFrom);
  return { list: sortThresholds([...without, clean]), errors: [] };
}

/** Entries starting today or later can still be removed; earlier ones are history. */
export function canRemoveEntry(entry, today) {
  return entry.effectiveFrom >= today;
}

export function removeThresholdEntry(list, effectiveFrom, today) {
  const entry = list.find((e) => e.effectiveFrom === effectiveFrom);
  if (!entry || !canRemoveEntry(entry, today)) return list;
  return list.filter((e) => e.effectiveFrom !== effectiveFrom);
}

/** Default effective date for a new entry: tomorrow, so today's workouts are unchanged. */
export function defaultEffectiveFrom(today) {
  return addDays(today, 1);
}
