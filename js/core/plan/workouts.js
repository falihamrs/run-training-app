// Section 7: the workout library. Every builder returns steps that hold zone ids, never paces.
//
// Step shapes:
//   { kind: 'warmup'|'easy'|'steady'|'work'|'cooldown'|'strides', durationMin, zone, ... }
//   { kind: 'repeat', reps, work: { durationMin|durationSec, zone }, rec: { durationMin|durationSec, zone } }
// A step may carry climbM, flat (pace is shown only when true in trail mode) and note.

export const THR_LADDER = [[3, 5], [4, 6], [3, 8], [4, 8], [3, 10], [2, 15], [1, 20], [1, 30]];
export const VO2_LADDER = [[5, 2], [5, 3], [6, 3], [5, 4], [6, 4], [5, 5]];
export const MP_LADDER_KM = [5, 8, 10, 13, 16];
export const CLB_LADDER = [[3, 6], [4, 6], [3, 8], [4, 8], [3, 10], [4, 10], [3, 12]];
export const TMP_LADDER_MIN = [20, 22, 25, 28, 30];

export const NAMES = {
  EZ: 'Easy run', RC: 'Recovery run', STR: 'Strides', LR: 'Long run', LRP: 'Long run with progression',
  LRM: 'Long run with marathon-pace block', FAR: 'Fartlek', HIL: 'Short hill repeats', THR: 'Threshold intervals',
  TMP: 'Tempo run', VO2: 'VO2 intervals', REP: 'Repetitions', RP: 'Race-pace session', SHK: 'Shakeout',
  CLB: 'Climbing intervals', HIKE: 'Hiking intervals', DWN: 'Downhill practice', INC: 'Incline session',
  B2B: 'Back-to-back long run', MED: 'Medium run (back-to-back)', SIM: 'Race simulation', STRG: 'Strength',
  RACE: 'Race',
};

export const WARM = { kind: 'warmup', durationMin: 12, zone: 'Z2' };
export const COOL = { kind: 'cooldown', durationMin: 10, zone: 'Z1' };

export const stepMinutes = (s) => {
  if (s.kind === 'repeat') {
    const m = (p) => (p.durationMin ?? 0) + (p.durationSec ?? 0) / 60;
    return s.reps * (m(s.work) + m(s.rec ?? {}));
  }
  return s.durationMin ?? 0;
};
export const totalMinutes = (steps) => Math.round(steps.reduce((t, s) => t + stepMinutes(s), 0));

export function strides(flat = true) {
  return { kind: 'strides', reps: 6, durationSec: 20, durationMin: 4, zone: 'Z5c', flat, note: '6 × 20 s fast and relaxed, 60–90 s walk or jog between' };
}

export function easySteps(min, { zone = 'Z2', flat = true, climbM = 0, note } = {}) {
  return [{ kind: 'easy', durationMin: min, zone, flat, ...(climbM ? { climbM } : {}), ...(note ? { note } : {}) }];
}

export function thresholdSteps(rung) {
  const [reps, work] = THR_LADDER[rung];
  if (reps === 1) return [WARM, { kind: 'work', durationMin: work, zone: 'Z4', flat: true }, COOL];
  return [WARM, { kind: 'repeat', reps, work: { durationMin: work, zone: 'Z4' }, rec: { durationMin: Math.max(1, Math.round(work / 5)), zone: 'Z1' }, flat: true }, COOL];
}

export function vo2Steps(rung) {
  const [reps, work] = VO2_LADDER[rung];
  return [WARM, { kind: 'repeat', reps, work: { durationMin: work, zone: 'Z5b' }, rec: { durationMin: Math.round(work * 0.75 * 2) / 2, zone: 'Z1' }, flat: true }, COOL];
}

export function fartlekSteps(reps, { trail = false } = {}) {
  return trail
    ? [WARM, { kind: 'repeat', reps, work: { durationMin: 2, zone: 'Z4' }, rec: { durationMin: 2, zone: 'Z1' }, flat: true }, COOL]
    : [WARM, { kind: 'repeat', reps, work: { durationMin: 1, zone: 'Z5a' }, rec: { durationMin: 1, zone: 'Z1' }, flat: true }, COOL];
}

export function hillRepeatSteps(rung, climbM = 0) {
  const reps = Math.min(10, 6 + rung);
  const sec = reps <= 7 ? 30 : reps === 8 ? 40 : 45;
  return [WARM, { kind: 'repeat', reps, work: { durationSec: sec, zone: 'Z5', rpe: '8' }, rec: { durationMin: 1.5, zone: 'Z1' }, flat: false, ...(climbM ? { climbM } : {}), note: 'Steep hill, about 10% grade; walk down' }, COOL];
}

export function climbSteps(rung, climbM = 0) {
  let [reps, work] = CLB_LADDER[rung];
  while (reps * work > 40 && reps > 1) reps--;
  return [WARM, { kind: 'repeat', reps, work: { durationMin: work, zone: 'Z4' }, rec: { durationMin: 2.5, zone: 'Z1' }, flat: false, ...(climbM ? { climbM } : {}), note: 'Uphill; walk or jog down' }, COOL];
}

export function downhillSteps(rung) {
  const reps = Math.min(10, 6 + rung);
  const min = rung < 3 ? 2 : 3;
  return [WARM, { kind: 'repeat', reps, work: { durationMin: min, zone: 'Z3', rpe: '6' }, rec: { durationMin: min, zone: 'Z1' }, flat: false, note: 'Controlled fast descent, relaxed form; walk or jog back up' }, COOL];
}

export function hikeSteps(rung, climbM = 0) {
  const reps = Math.min(6, 4 + Math.floor(rung / 2));
  const min = Math.min(10, 6 + rung);
  return [WARM, { kind: 'repeat', reps, work: { durationMin: min, zone: 'Z3', zoneHigh: 'Z4' }, rec: { durationMin: 2.5, zone: 'Z1' }, flat: false, ...(climbM ? { climbM } : {}), note: 'Fast uphill hiking, hands on knees if needed' }, COOL];
}

export function inclineSteps(kind, min, climbM = 0) {
  if (kind === 'intervals') {
    return [WARM, { kind: 'repeat', reps: 7, work: { durationMin: 3, zone: 'Z4' }, rec: { durationMin: 2, zone: 'Z1' }, flat: false, ...(climbM ? { climbM } : {}), note: 'Treadmill at 10–15% grade or stairs' }, COOL];
  }
  return [{ kind: 'steady', durationMin: min, zone: 'Z2', zoneHigh: 'Z3', flat: false, ...(climbM ? { climbM } : {}), note: 'Treadmill at 8–12% grade or stairs' }];
}

export function tempoSteps(min, zone = 'Z4', flat = true) {
  return [WARM, { kind: 'work', durationMin: min, zone, flat }, COOL];
}

export function racePaceSteps(cat, goalPaceSecPerKm) {
  const plan = { '5k': [5, 1], '10k': [4, 2], half: [3, 3], marathon: [3, 3] }[cat];
  const [reps, km] = plan;
  const min = Math.round(((km * goalPaceSecPerKm) / 60) * 2) / 2;
  return [WARM, { kind: 'repeat', reps, work: { durationMin: min, zone: 'RP', note: `${km} km at goal race pace` }, rec: { durationMin: km >= 3 ? 3 : 2, zone: 'Z1' }, flat: true }, COOL];
}

export function longProgressionSteps(totalMin) {
  const hard = Math.max(10, Math.round(totalMin * 0.25));
  return [{ kind: 'easy', durationMin: totalMin - hard, zone: 'Z2', flat: true }, { kind: 'steady', durationMin: hard, zone: 'Z3', flat: true }];
}

export function longMarathonBlockSteps(totalMin, blockMin) {
  const rest = Math.max(10, totalMin - blockMin);
  const before = Math.round(rest / 2);
  return [{ kind: 'easy', durationMin: before, zone: 'Z2', flat: true }, { kind: 'work', durationMin: blockMin, zone: 'RP', flat: true }, { kind: 'easy', durationMin: rest - before, zone: 'Z2', flat: true }];
}

export function shakeoutSteps() {
  return [{ kind: 'easy', durationMin: 18, zone: 'Z2', flat: true }, { ...strides(true), reps: 4, note: '4 × 20 s relaxed' }];
}

export function strengthSteps() {
  return [
    { kind: 'exercise', name: 'Squats or step-ups', sets: 3, reps: '8–12' },
    { kind: 'exercise', name: 'Lunges', sets: 3, reps: '8–12 each leg' },
    { kind: 'exercise', name: 'Calf raises', sets: 3, reps: '10–12' },
    { kind: 'exercise', name: 'Single-leg deadlifts', sets: 2, reps: '8–10 each leg' },
    { kind: 'exercise', name: 'Plank', sets: 3, reps: '30–45 s' },
  ];
}

// Shrinks a quality session to fit a time budget: fewer reps, then shorter warm-up/cool-down, then a shorter main set.
export function fitSteps(steps, maxMin) {
  if (totalMinutes(steps) <= maxMin) return steps;
  const s = steps.map((x) => ({ ...x }));
  const total = () => totalMinutes(s);
  const main = s.find((x) => ['repeat', 'work', 'steady', 'easy'].includes(x.kind));
  while (main?.kind === 'repeat' && main.reps > 3 && total() > maxMin) main.reps -= 1;
  for (const x of s) {
    if (x.kind === 'warmup') while (x.durationMin > 8 && total() > maxMin) x.durationMin -= 1;
    if (x.kind === 'cooldown') while (x.durationMin > 6 && total() > maxMin) x.durationMin -= 1;
  }
  if (main && main.kind !== 'repeat') while (main.durationMin > 10 && total() > maxMin) main.durationMin -= 1;
  while (main?.kind === 'repeat' && main.reps > 2 && total() > maxMin) main.reps -= 1;
  return s;
}
