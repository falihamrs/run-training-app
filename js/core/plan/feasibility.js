// Section 4: feasibility check, peak targets and plan length.
import { diffDays, mondayOnOrBefore, weekdayOf } from '../dates.js';
import { kmEffort } from '../race.js';
import { thresholdForDate, earliestThreshold } from '../thresholds.js';
import { formatDuration } from '../units.js';
import {
  EXPERIENCE_INDEX, ROAD_TABLE, TRAIL_LONG_CAP_H, TRAIL_MIN_PER_EFFORT_KM, TRAIL_PEAK_HOURS_CAP,
  TRAIL_PEAK_HOURS_MULT, TRAIL_PEAK_VERT_SHARE, predictRoadTime, roadCategory, round025, trailClass,
} from './tables.js';
import { buildVolume } from './skeleton.js';

const hm = (min) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} min`;

/**
 * @returns {{status:'OK'|'WARN'|'BLOCK', messages:{level,code,text}[], params?:object}}
 */
export function checkFeasibility(settings, history, { effectiveRuns, allowShort = false, overrideEntry = false } = {}) {
  const messages = [];
  const block = (code, text) => messages.push({ level: 'block', code, text });
  const warn = (code, text) => messages.push({ level: 'warn', code, text });
  const info = (code, text) => messages.push({ level: 'info', code, text });

  const { race, schedule, athlete } = settings;
  const trail = race.mode === 'trail';
  const xp = EXPERIENCE_INDEX[athlete.experience] ?? 1;
  const startMonday = mondayOnOrBefore(schedule.startDate);
  const raceMonday = mondayOnOrBefore(race.date);
  const runs = effectiveRuns ?? schedule.runsPerWeek;

  if (race.date <= schedule.startDate) {
    block('dates', 'The start date is on or after the race date.');
    return { status: 'BLOCK', messages };
  }
  const W = Math.floor(diffDays(startMonday, raceMonday) / 7) + 1;
  const entry = thresholdForDate(settings.thresholds, startMonday) ?? earliestThreshold(settings.thresholds);
  if (trail && entry?.lthr == null) {
    block('thresholds', 'Trail mode needs an LTHR. Enter one, or run a 30-minute climb test and upload it.');
  }
  if (!trail && entry?.paceSecPerKm == null) {
    block('thresholds', 'Road mode needs a threshold pace. Enter one, or run a 30-minute test and upload it.');
  }
  if (messages.some((m) => m.level === 'block')) return { status: 'BLOCK', messages };

  const earlyRace = ['Mon', 'Tue'].includes(weekdayOf(race.date));
  const Wt = W - (earlyRace ? 1 : 0); // training weeks: a Monday or Tuesday race leaves its own week empty
  const params = { W, startMonday, raceMonday, trail, xp, entry, earlyRace };
  if (history.returnFromBreak) warn('break', 'You are returning from a break, so the plan starts from a reduced baseline.');

  if (trail) {
    const effort = kmEffort(race.distanceKm, race.elevationGainM);
    const cls = trailClass(effort);
    if (race.distanceKm > 45 || !cls) {
      block('size', 'Trail races above 45 km or 75 km-effort are outside version 1.');
      return { status: 'BLOCK', messages };
    }
    const minPerEffort = history.trailPaceMinPerKmEffort ?? TRAIL_MIN_PER_EFFORT_KM[xp];
    const TrMin = effort * minPerEffort;
    const TrRange = [Math.round(TrMin * 0.9), Math.round(TrMin * 1.1)];
    const peakHours = round025(Math.min(TRAIL_PEAK_HOURS_CAP[xp], Math.max(4, (TrMin / 60) * TRAIL_PEAK_HOURS_MULT[xp])));
    const peakVert = Math.round(TRAIL_PEAK_VERT_SHARE[xp] * race.elevationGainM);
    const peakLongMin = Math.round(Math.min(0.7 * TrMin, TRAIL_LONG_CAP_H[xp] * 60));
    const taperWeeks = effort >= 25 ? 2 : 1;
    Object.assign(params, { effort, cls, TrMin, TrRange, peakHours, peakVert, peakLongMin, taperWeeks, minPerEffort });

    if (Wt < cls.block) (allowShort ? warn : block)('weeks', `Only ${Wt} weeks until the race. A race of ${cls.label} needs at least ${cls.block} weeks.`);
    if (cls.entry) {
      const [h, longH] = cls.entry;
      if ((history.baselineWeeklyHours ?? 0) < h || (history.longestRunMin ?? 0) < longH * 60) {
        (overrideEntry ? warn : block)('entry', `For a race of ${cls.label} you should already train about ${h} h a week with a longest run of ${longH} h. ${overrideEntry ? 'You chose to build the plan anyway, so progress carefully and cut back at any sign of injury.' : 'Build a base first or pick a shorter race.'}`);
      }
    }
    if (messages.some((m) => m.level === 'block')) return { status: 'BLOCK', messages, params };
    if (Wt >= cls.block && Wt < cls.rec) warn('weeks', `${Wt} weeks is below the recommended ${cls.rec} weeks.`);

    const vol = buildVolume(params, history, settings);
    params.volume = vol;
    const reachVert = Math.max(...vol.weeks.filter((w) => w.kind !== 'taper').map((w) => w.targetVertM));
    params.reachableVertM = reachVert;
    if (peakVert > 0 && reachVert < 0.8 * peakVert) {
      warn('climb', `Reachable weekly climbing is ${reachVert} m, ${Math.round((100 * reachVert) / peakVert)}% of the ${peakVert} m target.`);
    }
    const density = race.elevationGainM / race.distanceKm;
    if (density > 100) warn('density', 'Climbing density above 100 m/km is steeper than the defaults were tuned for.');
    const dt = schedule.dayTerrain ?? {};
    const avail = Object.keys(dt).filter((d) => !(schedule.unavailableDays ?? []).includes(d));
    if (race.elevationGainM >= 1000 && !avail.some((d) => dt[d] === 'hills')) {
      warn('hills', 'No hills day is set, so weekday climbing must come from incline sessions.');
    }
    if (race.cutoffSec && TrRange[1] * 60 > race.cutoffSec - 1800) {
      warn('cutoff', `The slow end of the expected duration (${hm(TrRange[1])}) is within 30 minutes of the cut-off.`);
    }
    if (peakHours > 0 && peakVert / peakHours > 350) warn('vertPerHour', 'The plan averages more than 350 m of climbing per training hour.');
    if (race.goalTimeSec && race.goalTimeSec < TrRange[0] * 60 * 0.9) warn('goal', `The goal time is much faster than the expected ${hm(TrRange[0])} to ${hm(TrRange[1])}.`);
    info('duration', `Expected race duration: ${hm(TrRange[0])} to ${hm(TrRange[1])}.`);
  } else {
    const cat = roadCategory(race.distanceKm);
    const t = ROAD_TABLE[cat];
    const T = entry.paceSecPerKm;
    const predicted = predictRoadTime(T, race.distanceKm);
    const peakKm = t.peakKm[xp];
    const peakLong = t.peakLong[xp];
    const taperWeeks = t.taper.length;
    Object.assign(params, { cat, table: t, predictedSec: predicted, peakKm, peakLong, taperWeeks });

    if (Wt < t.block) (allowShort ? warn : block)('weeks', `Only ${Wt} weeks until the race. A ${t.label} needs at least ${t.block} weeks.`);
    if (t.entry) {
      const [km, longKm] = t.entry;
      if (history.baselineWeeklyKm < km || history.longestRunKm < longKm) {
        const text = `For a ${t.label} you should already run ${km} km a week with a longest run of ${longKm} km. ${overrideEntry && t.entryBlock ? 'You chose to build the plan anyway, so progress carefully and cut back at any sign of injury.' : 'Build a base first or pick a shorter race.'}`;
        if (t.entryBlock && !overrideEntry) block('entry', text); else warn('entry', text);
      }
    }
    if (messages.some((m) => m.level === 'block')) return { status: 'BLOCK', messages, params };
    if (Wt >= t.block && Wt < t.rec) warn('weeks', `${Wt} weeks is below the recommended ${t.rec} weeks.`);
    const vol = buildVolume(params, history, settings);
    params.volume = vol;
    const reach = Math.max(...vol.weeks.filter((w) => w.kind !== 'taper').map((w) => w.targetKm));
    params.reachableKm = reach;
    if (reach < 0.8 * peakKm) warn('peak', `Reachable peak is about ${reach} km a week, ${Math.round((100 * reach) / peakKm)}% of the ${peakKm} km target.`);
    if (athlete.experience === 'new' && cat === 'marathon') warn('new', 'A marathon as a first race is demanding. Take the long runs gently.');
    if (cat === 'marathon' && runs < 4) warn('runs', 'Training a marathon on fewer than 4 runs a week is hard.');
    const goal = race.goalTimeSec;
    if (goal) {
      const gap = (predicted - goal) / predicted;
      if (gap >= 0.1) warn('goal', `The goal ${formatDuration(goal)} looks unrealistic. Your threshold predicts about ${formatDuration(predicted)}, so plan for that instead.`);
      else if (gap >= 0.05) warn('goal', `The goal ${formatDuration(goal)} is faster than the predicted ${formatDuration(predicted)}.`);
    }
    info('predicted', `Predicted race time: ${formatDuration(Math.round(predicted * 0.97))} to ${formatDuration(Math.round(predicted * 1.03))}.`);
  }

  if (runs < schedule.runsPerWeek) warn('runsReduced', `Only ${runs} days are available, so the plan uses ${runs} runs per week.`);
  const status = messages.some((m) => m.level === 'warn') ? 'WARN' : 'OK';
  return { status, messages, params };
}
