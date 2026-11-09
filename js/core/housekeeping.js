// Housekeeping helpers: pick runs for bulk deletion and find leftovers in stored data.

/** Runs dated from `from` to `to` (inclusive, YYYY-MM-DD, either can be empty). Races can be kept. */
export function runsInRange(runs, from, to, { keepRaces = true } = {}) {
  if (!from && !to) return [];
  return runs.filter((r) => (!from || r.date >= from) && (!to || r.date <= to) && !(keepRaces && r.race));
}

/**
 * Looks for data that no longer belongs together.
 * - orphanStreams: stream records whose run is gone
 * - danglingMatches: runs matched to a workout that is not in the current plan (or there is no plan)
 * - missingStreams: runs without stream data (informational; they still count in the history summary)
 */
export function integrityReport({ runs, streamIds, plan }) {
  const runIds = new Set(runs.map((r) => r.id));
  const workoutIds = new Set((plan?.weeks ?? []).flatMap((w) => w.workouts.map((x) => x.id)));
  const have = new Set(streamIds);
  const orphanStreams = streamIds.filter((id) => !runIds.has(id));
  const danglingMatches = runs.filter((r) => r.matchedWorkoutId && !workoutIds.has(r.matchedWorkoutId)).map((r) => r.id);
  const missingStreams = runs.filter((r) => !have.has(r.id)).map((r) => r.id);
  return { orphanStreams, danglingMatches, missingStreams, fixable: orphanStreams.length + danglingMatches.length };
}

export function formatBytes(n) {
  if (n == null) return 'unknown';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
