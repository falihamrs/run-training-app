// generatePlan(settings, history, opts) -> Plan. Pure and deterministic (spec sections 4 to 6).
import { WEEKDAYS, addDays, diffDays, weekdayOf } from '../dates.js';
import { validateSettings } from '../validate.js';
import { effectiveStrengthSettings } from './strength.js';
import { checkFeasibility } from './feasibility.js';
import { placeRoles } from './layout.js';
import { ROAD_TABLE, TRAIL_LONG_CAP_H, round5, roadCategory } from './tables.js';
import * as W from './workouts.js';

const round05 = (x) => Math.round(x * 2) / 2;
const hasClimbSteps = (code) => ['CLB', 'HIL', 'HIKE', 'DWN', 'INC'].includes(code);

const COVERAGE_MIN = 0.85;
const LONG_FLOOR_MIN = 20; // same as the shortest easy run

// How much of each weekly target the placed workouts actually reach, over build and peak load weeks.
function coverageOf(weeks, trail) {
  const load = weeks.filter((w) => w.kind === 'load' && (w.phase === 'build' || w.phase === 'peak'));
  const measure = (label, target, placed) => {
    const t = load.reduce((sum, w) => sum + (target(w) ?? 0), 0);
    return t > 0 ? { label, ratio: load.reduce((sum, w) => sum + (placed(w) ?? 0), 0) / t } : null;
  };
  const list = (trail
    ? [measure('climbing', (w) => w.targetVertM, (w) => w.plannedVertM), measure('weekly time', (w) => (w.targetHours ?? 0) * 60, (w) => w.plannedMin)]
    : [measure('weekly distance', (w) => w.targetKm, (w) => w.plannedKm)]
  ).filter(Boolean);
  return { worst: list.length ? Math.min(...list.map((m) => m.ratio)) : 1, gaps: list.filter((m) => m.ratio < COVERAGE_MIN) };
}

export function generatePlan(settingsIn, history, { today, id = 'main', now = null, allowShort = false, overrideEntry = false, noRunAdvice = false, resume = null } = {}) {
  const v = validateSettings(settingsIn, { today });
  if (v.errors.length) {
    return { status: 'BLOCK', messages: v.errors.map((e) => ({ level: 'block', code: 'input', text: e.message })), plan: null };
  }
  const settings = v.normalized;
  const resumePhases = resume?.phases ?? null;
  let feas = checkFeasibility(settings, history, { effectiveRuns: v.effectiveRunsPerWeek, allowShort, overrideEntry, resumePhases });
  // Below the usual starting point is not final: a plan with enough weeks can build that base first.
  // Build it without the entry block, then decide at the end whether the lead-in is long enough.
  const strict = feas;
  const strictBlocks = feas.messages.filter((m) => m.level === 'block');
  const entryPending = feas.status === 'BLOCK' && strictBlocks.length === 1 && strictBlocks[0].code === 'entry';
  if (entryPending) feas = checkFeasibility(settings, history, { effectiveRuns: v.effectiveRunsPerWeek, allowShort, overrideEntry: true, resumePhases });
  if (feas.status === 'BLOCK') return { status: 'BLOCK', messages: feas.messages, plan: null };

  const { params } = feas;
  const { race, schedule } = settings;
  const trail = params.trail;
  const messages = [...feas.messages];
  const available = WEEKDAYS.filter((d) => !(schedule.unavailableDays ?? []).includes(d));
  const terrain = schedule.dayTerrain;
  const T = params.entry.paceSecPerKm ?? null;
  const easyPace = !trail && T ? Math.round(T * 1.215) : history.easyPaceSecPerKm ?? 390;
  const cat = trail ? null : params.cat;
  const goalPace = trail ? null : Math.round((race.goalTimeSec && (params.predictedSec - race.goalTimeSec) / params.predictedSec < 0.1 ? race.goalTimeSec : params.predictedSec) / race.distanceKm);
  const strengthPerWeek = effectiveStrengthSettings(settings);
  const raceDate = race.date;
  const raceWeekday = weekdayOf(raceDate);
  const raceIdx = WEEKDAYS.indexOf(raceWeekday);

  const vol = params.volume;
  const nWeeks = vol.weeks.length;
  const layoutCache = new Map();
  const layoutFor = (key, opts) => {
    if (!layoutCache.has(key)) layoutCache.set(key, placeRoles({ trail, terrain, longDay: schedule.longRunDay, ...opts }));
    return layoutCache.get(key);
  };

  // Race-like weeks follow a normal week, so their quality session should avoid the day after the normal long run.
  const normalLayout = layoutFor('normal', { runs: v.effectiveRunsPerWeek, available, b2b: false });
  const afterLong = normalLayout?.longDay ? WEEKDAYS[(WEEKDAYS.indexOf(normalLayout.longDay) + 1) % 7] : null;

  const state = {
    // a regenerated plan carries on from the sessions already done instead of restarting each ladder
    ptr: { THR: 0, VO2: 0, CLB: 0, HIL: 0, DWN: 0, FAR: 0, TMP: 0, HIKE: 0, MP: 0, ...(resume?.ptr ?? {}) },
    prevLong: trail ? Math.min(history.longestRunMin ?? 0, 9999) : history.longestRunKm ?? 0,
    lastLoadLong: 0,
    phaseIdx: { base: 0, build: 0, peak: 0, taper: 0, ...(resume?.phaseIdx ?? {}) },
  };
  const seenLayoutMessages = new Set();
  const weeks = [];

  for (const vw of vol.weeks) {
    const start = addDays(params.startMonday, 7 * (vw.n - 1));
    const isRaceWeek = vw.n === nWeeks;
    const finalPrep = params.earlyRace && vw.n === nWeeks - 1;
    const raceLike = isRaceWeek || finalPrep; // weeks that follow race-week rules
    const down = vw.kind === 'down';
    state.phaseIdx[vw.phase] += 1;
    const pIdx = state.phaseIdx[vw.phase];
    const flags = [];

    // ---- layout ----
    const b2bWeek = trail && vw.phase === 'peak' && pIdx % 2 === 0 && !down && params.TrMin >= 240 && vw.targetHours >= 4;
    // race-like weeks must keep quality off the day after the last long run; back-to-back weeks only prefer it,
    // because moving the climbing session to a flat day would cost more than it gains
    const layoutOpts = { runs: v.effectiveRunsPerWeek, available, b2b: b2bWeek, avoidHard: raceLike || b2bWeek ? afterLong : null, avoidCost: b2bWeek ? 5 : 50 };
    let layout;
    if (isRaceWeek) {
      let raceAvail = available.filter((d) => WEEKDAYS.indexOf(d) < raceIdx);
      // the day before the race is the shakeout, so it does not count as one of the week's runs
      const shakeDay = WEEKDAYS[(raceIdx + 6) % 7];
      const withoutShake = raceAvail.filter((d) => d !== shakeDay);
      let raceRuns = layoutOpts.runs;
      if (withoutShake.length >= 3) { raceAvail = withoutShake; raceRuns = Math.max(2, layoutOpts.runs - 1); }
      layout = layoutFor(`race-${raceWeekday}`, { ...layoutOpts, available: raceAvail, runs: Math.min(raceRuns, Math.max(2, raceAvail.length)), noLong: true, b2b: false });
    } else if (finalPrep) {
      // Race early next week: this is the last training week, laid out like a race week (no long run).
      let avail = available;
      let prepRuns = layoutOpts.runs;
      if (raceIdx === 0) {
        const withoutShake = available.filter((d) => d !== 'Sun');
        if (withoutShake.length >= 3 && available.includes('Sun')) { avail = withoutShake; prepRuns = Math.max(2, layoutOpts.runs - 1); }
      }
      layout = layoutFor('final-prep', { ...layoutOpts, available: avail, runs: Math.min(prepRuns, Math.max(2, avail.length)), noLong: true, b2b: false });
    } else {
      layout = layoutFor(b2bWeek ? 'b2b' : 'normal', layoutOpts);
    }
    if (!layout) {
      flags.push('Could not place the weekly runs on the available days.');
      layout = { assign: {}, messages: [] };
    }
    for (const m of layout.messages) {
      if (!seenLayoutMessages.has(m)) { seenLayoutMessages.add(m); messages.push({ level: 'warn', code: 'layout', text: m }); }
    }
    const assign = { ...layout.assign };
    if (down && !trail) for (const d of Object.keys(assign)) if (assign[d] === 'Q2') assign[d] = 'E';
    const dayOfRole = (r) => Object.keys(assign).find((d) => assign[d] === r);
    const runCount = Object.keys(assign).length;

    // ---- distribute volume ----
    const workouts = [];
    const mk = (day, code, role, steps, extra = {}) => {
      const min = W.totalMinutes(steps);
      workouts.push({
        id: `w${vw.n}-${day}`, date: addDays(start, WEEKDAYS.indexOf(day)), weekday: day, week: vw.n,
        code, name: extra.name ?? W.NAMES[code] ?? code, role, terrain: terrain[day], steps, plannedMin: min,
        plannedKm: trail ? null : Math.round(((min * 60) / (extra.paceFor ?? easyPace * (code === 'EZ' || code === 'RC' || code.startsWith('L') ? 1 : 0.93))) * 10) / 10,
        plannedVertM: extra.vertM ?? 0, notes: extra.notes ?? [], locked: false,
      });
    };

    const qCode = {};
    const longDay = dayOfRole('L');
    const q1Day = dayOfRole('Q1');
    const q2Day = dayOfRole('Q2');
    const medDay = dayOfRole('M');
    const weekMin = trail ? vw.targetHours * 60 : null;
    const weekKm = trail ? null : vw.targetKm;

    // long run size
    let longSize = null;
    if (longDay) {
      if (trail) {
        const share = layout.b2b ? 0.4 : runCount <= 4 ? 0.5 : runCount === 5 ? 0.45 : 0.4;
        if (down) longSize = Math.round(0.8 * state.lastLoadLong);
        else {
          longSize = Math.min(share * weekMin, params.peakLongMin, state.prevLong + 20);
          longSize = Math.max(30, round5(longSize));
          state.lastLoadLong = longSize;
        }
        state.prevLong = Math.max(state.prevLong, longSize);
      } else {
        const share = runCount <= 4 ? 0.35 : runCount === 5 ? 0.3 : 0.28;
        if (down) longSize = round05(0.8 * state.lastLoadLong);
        else {
          longSize = round05(Math.max(3, Math.min(share * weekKm, params.peakLong, state.prevLong + 2)));
          state.lastLoadLong = longSize;
        }
        state.prevLong = Math.max(state.prevLong, longSize);
      }
    }
    let longMin = longSize == null ? 0 : trail ? longSize : Math.round((longSize * easyPace) / 60);
    // a road recovery week shrinks the long run to 80%; it never drops below the shortest easy run
    if (!trail && longMin > 0 && longMin < LONG_FLOOR_MIN) longMin = LONG_FLOOR_MIN;

    // quality sessions
    const quality = {};
    const nextRung = (type, ladderLen) => {
      const r = Math.min(state.ptr[type], ladderLen - 1);
      return r;
    };
    const bump = (type) => { state.ptr[type] += 1; };
    if (down) for (const k of Object.keys(state.ptr)) state.ptr[k] = Math.max(0, state.ptr[k] - 2);

    const phase = vw.phase;
    const pickRoad = (slot) => {
      // returns { code, steps, extra }
      const cap = (km, frac, abs) => km <= frac * weekKm && (abs == null || km <= abs);
      const thr = (rungWanted) => {
        let r = Math.min(rungWanted, W.THR_LADDER.length - 1);
        const hardKm = (rung) => (W.THR_LADDER[rung][0] * W.THR_LADDER[rung][1] * 60) / T / 1;
        while (r > 0 && !cap(hardKm(r), 0.1)) r--;
        return r;
      };
      const vo2 = (rungWanted) => {
        let r = Math.min(rungWanted, W.VO2_LADDER.length - 1);
        const hardKm = (rung) => (W.VO2_LADDER[rung][0] * W.VO2_LADDER[rung][1] * 60) / (T * 0.93);
        while (r > 0 && !cap(hardKm(r), 0.08, 8)) r--;
        return r;
      };
      if (phase === 'base') {
        if (slot === 'Q2') return null;
        const useHill = state.ptr.FAR % 2 === 1;
        const reps = Math.min(10, 6 + state.ptr.FAR);
        bump('FAR');
        return useHill ? { code: 'HIL', steps: W.hillRepeatSteps(Math.min(4, state.ptr.HIL++)) } : { code: 'FAR', steps: W.fartlekSteps(reps) };
      }
      if (phase === 'taper') {
        if (slot === 'Q2') return null;
        return cat === '5k' || cat === '10k' ? { code: 'RP', steps: W.racePaceSteps(cat, goalPace).slice(0, 2).map((s) => (s.kind === 'repeat' ? { ...s, reps: Math.max(2, Math.ceil(s.reps / 2)) } : s)).concat([W.COOL]) } : { code: 'THR', steps: W.thresholdSteps(0) };
      }
      if (phase === 'build') {
        if (slot === 'Q1') { const r = thr(nextRung('THR', W.THR_LADDER.length)); bump('THR'); return { code: 'THR', steps: W.thresholdSteps(r) }; }
        if (cat === 'marathon') return { code: 'TMP', steps: W.tempoSteps(30, 'Z3'), extra: { name: 'Steady run (Z3)' } };
        const r = vo2(nextRung('VO2', W.VO2_LADDER.length)); bump('VO2');
        return { code: 'VO2', steps: W.vo2Steps(r) };
      }
      // peak
      if (slot === 'Q1') return { code: 'RP', steps: W.racePaceSteps(cat, goalPace) };
      return { code: 'THR', steps: W.thresholdSteps(thr(3)), extra: { name: 'Threshold maintenance' } };
    };

    const pickTrail = (slot, day) => {
      const t = terrain[day];
      if (down && slot === 'Q2') {
        // recovery week: keep the climbing but drop the intensity
        if (t === 'incline') return { code: 'INC', steps: W.inclineSteps('steady', 35), climb: true };
        if (t === 'hills') return { code: 'EZ', steps: W.easySteps(35, { zone: 'Z2', flat: false, climbM: 1 }), climb: true, extra: { name: 'Easy hilly run' } };
        return null;
      }
      if (phase === 'base') {
        if (slot === 'Q1') { const reps = Math.min(10, 6 + state.ptr.FAR); bump('FAR'); return { code: 'FAR', steps: W.fartlekSteps(Math.min(8, reps), { trail: true }), extra: { name: 'Flat fartlek by heart rate' } }; }
        if (t === 'hills') { const r = Math.min(4, state.ptr.HIL++); return { code: 'HIL', steps: W.hillRepeatSteps(r), climb: true }; }
        if (t === 'incline') return { code: 'INC', steps: W.inclineSteps('steady', 40), climb: true };
        return null;
      }
      if (phase === 'taper') {
        if (slot === 'Q2') return null;
        return { code: 'TMP', steps: W.tempoSteps(15), extra: { name: 'Short tempo (Z4)' } };
      }
      if (phase === 'build') {
        if (slot === 'Q1') { const m = W.TMP_LADDER_MIN[nextRung('TMP', W.TMP_LADDER_MIN.length)]; bump('TMP'); return { code: 'TMP', steps: W.tempoSteps(m), extra: { name: 'Flat tempo (Z4)' } }; }
        if (t === 'hills') {
          if (pIdx >= 3 && pIdx % 2 === 1) { const r = Math.min(4, state.ptr.DWN++); return { code: 'DWN', steps: W.downhillSteps(r), climb: false }; }
          const r = nextRung('CLB', W.CLB_LADDER.length); bump('CLB');
          return { code: 'CLB', steps: W.climbSteps(r), climb: true };
        }
        if (t === 'incline') return { code: 'INC', steps: W.inclineSteps('intervals', 0), climb: true };
        return { code: 'TMP', steps: W.tempoSteps(25), extra: { name: 'Flat tempo (Z4)' } };
      }
      // peak
      if (slot === 'Q1') return { code: 'TMP', steps: W.tempoSteps(20), extra: { name: 'Tempo maintenance (Z4)' } };
      if (t === 'hills') { const r = nextRung('HIKE', 6); bump('HIKE'); return { code: 'HIKE', steps: W.hikeSteps(r), climb: true }; }
      if (t === 'incline') return { code: 'INC', steps: W.inclineSteps('intervals', 0), climb: true };
      return { code: 'TMP', steps: W.tempoSteps(20), extra: { name: 'Tempo maintenance (Z4)' } };
    };

    if (q1Day) quality.Q1 = trail ? pickTrail('Q1', q1Day) : pickRoad('Q1');
    if (q2Day) quality.Q2 = trail ? pickTrail('Q2', q2Day) : pickRoad('Q2');
    for (const [slot, q] of Object.entries(quality)) {
      if (!q) { const d = slot === 'Q1' ? q1Day : q2Day; assign[d] = 'E'; }
    }

    const qMin = (slot) => (quality[slot] ? W.totalMinutes(quality[slot].steps) + (quality[slot].code === 'INC' && quality[slot].steps.length === 1 ? 0 : 0) : 0);
    let q1Min = qMin('Q1');
    let q2Min = qMin('Q2');
    if (trail && quality.Q2?.code === 'INC' && quality.Q2.steps[0].kind === 'repeat') { q2Min = W.totalMinutes(quality.Q2.steps); }

    // medium (b2b)
    let medMin = medDay ? Math.max(30, round5((trail ? 0.5 : 0.5) * longMin)) : 0;

    // fit the week: shrink quality sessions, drop a small easy run, and spread any slack in back-to-back weeks
    // the shakeout is added after the loop, so race-like weeks budget for it here
    const shakeDayName = WEEKDAYS[(raceIdx + 6) % 7];
    const shakeMin = available.includes(shakeDayName) && ((isRaceWeek && raceIdx >= 1) || (finalPrep && raceIdx === 0)) ? W.totalMinutes(W.shakeoutSteps()) : 0;
    const fitMin = Math.max(0, (trail ? weekMin : Math.round((weekKm * easyPace) / 60)) - shakeMin);
    {
      const MIN_EASY = 24; // 20 min plus strides
      const qSlots = () => ['Q1', 'Q2'].filter((k) => quality[k]?.steps);
      const easyList = () => WEEKDAYS.filter((d) => assign[d] === 'E' || assign[d] === 'R');
      const fixed = () => longMin + medMin;
      const need = () => fixed() + qSlots().length * 30 + easyList().length * MIN_EASY;
      while (Object.keys(assign).length > (raceLike ? 1 : 2) && need() > 1.1 * fitMin) {
        const list = easyList();
        if (list.length) {
          const d = list.filter((x) => assign[x] === 'R').pop() ?? list[list.length - 1];
          delete assign[d];
        } else if (quality.Q2 && q2Day && assign[q2Day] === 'Q2') {
          delete assign[q2Day];
          quality.Q2 = null;
          q2Min = 0;
        } else break;
        if (!flags.some((f) => f.startsWith('A run was dropped'))) flags.push('A run was dropped because the weekly time is too small for this many runs.');
      }
      if (qSlots().length) {
        const per = Math.max(trail ? 20 : 25, Math.floor((fitMin - fixed() - easyList().length * MIN_EASY) / qSlots().length));
        for (const k of qSlots()) if (W.totalMinutes(quality[k].steps) > per) quality[k].steps = W.fitSteps(quality[k].steps, per);
        q1Min = qMin('Q1');
        q2Min = qMin('Q2');
      }
      if (trail && layout.b2b && medDay && longDay && !easyList().length) {
        const room = weekMin - q1Min - q2Min;
        const newLong = Math.min(params.peakLongMin, round5(1.3 * longMin), round5(room / 1.5));
        if (newLong > longMin) {
          longMin = newLong;
          medMin = Math.max(30, Math.min(round5(room - newLong), round5(0.7 * newLong)));
          state.prevLong = Math.max(state.prevLong, longMin);
        }
      }
    }

    // time available for easy runs
    let totalMinTarget;
    totalMinTarget = fitMin;
    const roleOfDay = Object.fromEntries(Object.entries(assign));
    let easyDays = Object.keys(roleOfDay).filter((d) => roleOfDay[d] === 'E' || roleOfDay[d] === 'R');
    let remaining = totalMinTarget - longMin - medMin - (quality.Q1 ? q1Min : 0) - (quality.Q2 ? q2Min : 0);
    const weights = (d) => (roleOfDay[d] === 'R' ? 0.6 : 1);
    const floorMin = trail ? 20 : Math.round((3 * easyPace) / 60) > 20 ? Math.round((3 * easyPace) / 60) : 20;
    const droppedDays = [];
    const sizeOf = () => {
      const sw = easyDays.reduce((s, d) => s + weights(d), 0);
      return Object.fromEntries(easyDays.map((d) => [d, (remaining * weights(d)) / sw]));
    };
    let sizes = easyDays.length ? sizeOf() : {};
    while (easyDays.some((d) => sizes[d] < floorMin) && easyDays.some((d) => roleOfDay[d] === 'R')) {
      const r = easyDays.find((d) => roleOfDay[d] === 'R');
      easyDays = easyDays.filter((d) => d !== r);
      droppedDays.push(r);
      delete assign[r];
      sizes = easyDays.length ? sizeOf() : {};
    }
    if (droppedDays.length) flags.push('A recovery run was dropped because the weekly volume is too small to split further.');
    for (const d of easyDays) if (sizes[d] < floorMin) sizes[d] = floorMin;
    if (longMin > 0 && easyDays.length) {
      const capEasy = Math.max(floorMin, round5(longMin));
      let cut = 0;
      for (const d of easyDays) if (sizes[d] > capEasy) { cut += sizes[d] - capEasy; sizes[d] = capEasy; }
      if (!raceLike && cut > Math.max(15, 0.08 * totalMinTarget)) {
        flags.push(`About ${round5(cut)} min of this week's target was left out so that no easy run is longer than the long run. More runs a week would fit it.`);
      }
    }
    if (raceLike) for (const d of easyDays) sizes[d] = Math.min(sizes[d], 45);

    // ---- climbing allocation (trail) ----
    const alloc = {};
    if (trail) {
      let vert = vw.targetVertM;
      const climbQDay = quality.Q2?.climb ? q2Day : null;
      const hillsRun = Object.keys(assign).find((d) => d !== longDay && terrain[d] === 'hills' && assign[d] !== 'Q1' && !(climbQDay === d));
      const recipients = [];
      if (longDay) recipients.push({ day: longDay, share: 0.5, mins: longMin });
      if (climbQDay) recipients.push({ day: climbQDay, share: 0.25, mins: q2Min });
      const next = medDay ?? hillsRun;
      if (next) recipients.push({ day: next, share: 0.25, mins: medDay ? medMin : round5(sizes[next] ?? floorMin) });
      let placed = 0;
      for (const r of recipients) {
        const want = vert * r.share;
        const capM = Math.round((400 * r.mins) / 60);
        const got = Math.min(want, capM);
        alloc[r.day] = Math.floor(got / 10) * 10;
        placed += alloc[r.day];
      }
      const lost = Math.round(vert - placed);
      if (vert > 0 && !raceLike && vw.phase !== 'taper' && lost > Math.max(50, 0.05 * vert)) {
        flags.push(`${lost} m of the weekly climbing could not be placed on the available days.`);
      }
    }

    // ---- build the day workouts ----
    const longSteps = (() => {
      if (!longDay) return null;
      const climbM = alloc[longDay] ?? 0;
      if (trail) {
        if (layout.b2b) return { code: 'B2B', steps: [{ kind: 'easy', durationMin: longMin, zone: 'Z2', zoneHigh: 'Z3', flat: false, climbM, note: 'Day 1 of 2. Hike steep sections; climbs at Z3 at most' }], name: 'Long run (day 1 of back-to-back)' };
        if (phase === 'peak' && pIdx % 2 === 1 && !down) return { code: 'SIM', steps: [{ kind: 'easy', durationMin: longMin, zone: 'Z2', zoneHigh: 'Z3', flat: false, climbM, note: 'Race gear and race fuelling. Z2 on flat, Z3 on climbs' }], notes: ['Practise your own race fuelling (commonly 30–60 g of carbohydrate per hour, tested in training).'] };
        return { code: 'LR', steps: [{ kind: 'easy', durationMin: longMin, zone: 'Z2', flat: false, climbM, note: 'Hike the steep parts' }] };
      }
      if (phase === 'peak' && cat === 'marathon' && pIdx % 2 === 1 && !down) {
        const lad = W.MP_LADDER_KM.filter((k) => k <= 0.4 * longSize);
        if (lad.length) {
          const km = lad[Math.min(state.ptr.MP, lad.length - 1)];
          state.ptr.MP += 1;
          return { code: 'LRM', steps: W.longMarathonBlockSteps(longMin, Math.round((km * goalPace) / 60)), name: `Long run with ${km} km at marathon pace` };
        }
      }
      if ((phase === 'peak' || (phase === 'build' && pIdx % 2 === 0)) && !down && phase !== 'taper') return { code: 'LRP', steps: W.longProgressionSteps(longMin) };
      return { code: 'LR', steps: W.easySteps(longMin, { zone: 'Z2' }) };
    })();

    for (const d of WEEKDAYS) {
      const role = assign[d];
      if (!role) continue;
      if (role === 'L') mk(d, longSteps.code, 'L', longSteps.steps, { name: longSteps.name, vertM: alloc[d] ?? 0, notes: longSteps.notes, paceFor: easyPace });
      else if (role === 'M') mk(d, 'MED', 'M', W.easySteps(medMin, { zone: 'Z2', flat: false, climbM: alloc[d] ?? 0, note: 'Day 2 of 2, on tired legs' }), { vertM: alloc[d] ?? 0 });
      else if (role === 'Q1' || role === 'Q2') {
        const q = quality[role];
        if (q.steps) {
          const stepsWithClimb = q.steps.map((s) => (s.climbM !== undefined || (q.climb && (s.kind === 'repeat' || s.kind === 'steady')) ? { ...s, climbM: alloc[d] ?? 0 } : s));
          mk(d, q.code, role, stepsWithClimb, { name: q.extra?.name, vertM: q.climb ? alloc[d] ?? 0 : 0 });
        }
      } else if (role === 'E' || role === 'R') {
        const min = round5(sizes[d] ?? floorMin);
        const rec = role === 'R';
        const hill = terrain[d] === 'hills';
        const climbM = alloc[d] ?? 0;
        mk(d, rec ? 'RC' : 'EZ', role, W.easySteps(min, { zone: rec ? 'Z1' : 'Z2', flat: !(trail && hill && climbM), climbM }), { vertM: climbM });
      }
    }
    // strides on up to two flat easy runs
    let nStr = 0;
    for (const w of workouts) {
      if (w.code === 'EZ' && w.role !== 'Q2' && nStr < 2 && (!trail || terrain[w.weekday] === 'flat' || terrain[w.weekday] === 'incline') && vw.phase !== 'taper-last') {
        w.steps = [...w.steps, W.strides(true)];
        w.plannedMin = W.totalMinutes(w.steps);
        if (!trail) w.plannedKm = Math.round(((w.plannedMin * 60) / easyPace) * 10) / 10;
        w.hasStrides = true;
        nStr++;
      }
    }

    // intensity check: at least 75% of time in Z1 and Z2
    const easyShare = (list) => {
      let tot = 0, easy = 0;
      for (const w of list) for (const s of w.steps) {
        if (s.kind === 'exercise') continue;
        const m = W.stepMinutes(s);
        tot += m;
        const z = s.kind === 'repeat' ? null : s.zone;
        if (s.kind === 'repeat') { const mm = (p) => (p.durationMin ?? 0) + (p.durationSec ?? 0) / 60; tot += 0; easy += s.reps * mm(s.rec); }
        else if (z === 'Z1' || z === 'Z2') easy += m;
      }
      return tot ? easy / tot : 1;
    };
    if (easyShare(workouts) < 0.75 && q2Day && workouts.some((w) => w.role === 'Q2')) {
      const w = workouts.find((x) => x.role === 'Q2');
      const min = Math.max(20, round5(longMin ? Math.min(w.plannedMin, longMin) : w.plannedMin));
      w.code = 'EZ'; w.name = W.NAMES.EZ; w.role = 'E'; w.steps = [...W.easySteps(min, { zone: 'Z2' }), W.strides(true)]; w.plannedMin = W.totalMinutes(w.steps); w.plannedVertM = 0;
      if (!trail) w.plannedKm = Math.round(((w.plannedMin * 60) / easyPace) * 10) / 10;
      flags.push('Quality session 2 became an easy run with strides to keep at least 75% of the time easy.');
    }

    // strength
    const sPlanned = (() => {
      if (raceLike) return 0;
      if (vw.phase === 'peak') return Math.min(strengthPerWeek, 1);
      if (vw.phase === 'taper') return Math.min(strengthPerWeek, 1);
      return strengthPerWeek;
    })();
    if (sPlanned > 0) {
      const byDay = Object.fromEntries(workouts.map((w) => [w.weekday, w]));
      const isHard = (d) => ['L', 'Q1', 'Q2', 'M'].includes(byDay[d]?.role) && byDay[d].role !== 'M';
      const cands = WEEKDAYS.filter((d) => available.includes(d) && !isHard(d) && !isHard(WEEKDAYS[(WEEKDAYS.indexOf(d) + 1) % 7]) && !(byDay[d] && byDay[d].role === 'M'));
      const score = (d) => (byDay[d] ? 0 : 1) * 0 + (byDay[d] ? 0 : 0.5) + WEEKDAYS.indexOf(d) / 100;
      const sorted = [...cands].sort((a, b) => score(a) - score(b));
      const chosen = [];
      const ideal = sPlanned === 2 ? ['Mon', 'Thu'] : ['Wed'];
      const order = [...ideal.filter((d) => sorted.includes(d)), ...sorted];
      for (const d of order) {
        if (chosen.length >= sPlanned) break;
        if (chosen.every((c) => Math.abs(WEEKDAYS.indexOf(c) - WEEKDAYS.indexOf(d)) >= 2) && !(race.date === addDays(start, WEEKDAYS.indexOf(d)))) chosen.push(d);
      }
      if (chosen.length === 0) flags.push('No strength session fits this week without sitting before a hard day.');
      for (const d of chosen) {
        const steps = W.strengthSteps();
        workouts.push({
          id: `w${vw.n}-${d}-S`, date: addDays(start, WEEKDAYS.indexOf(d)), weekday: d, week: vw.n, code: 'STRG', name: W.NAMES.STRG, role: 'S',
          terrain: 'gym', steps, plannedMin: 25, plannedKm: null, plannedVertM: 0, notes: ['At the gym. 20 to 30 minutes, stop 2 reps short of failure.'], locked: false,
        });
      }
    }

    // race week trims
    let kept = workouts;
    if (isRaceWeek) kept = workouts.filter((w) => w.date < raceDate);
    kept.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.role === 'S' ? 1 : -1));

    const runW = kept.filter((w) => w.role !== 'S');
    weeks.push({
      n: vw.n, start, phase: vw.phase, kind: vw.kind, targetKm: vw.targetKm ?? null, targetHours: vw.targetHours ?? null, targetVertM: raceLike && trail ? 0 : vw.targetVertM ?? null,
      reason: vw.reason, flags, workouts: kept,
      plannedMin: runW.reduce((s, w) => s + w.plannedMin, 0),
      plannedKm: trail ? null : Math.round(runW.reduce((s, w) => s + (w.plannedKm ?? 0), 0) * 10) / 10,
      plannedVertM: runW.reduce((s, w) => s + (w.plannedVertM ?? 0), 0),
    });
  }

  // shakeout the day before the race, and the race itself
  const last = weeks[weeks.length - 1];
  const dayBefore = addDays(raceDate, -1);
  const prevWeek = diffDays(last.start, dayBefore) < 0 ? weeks[weeks.length - 2] : last;
  // a hard session must not sit the day after the previous week's long run (weeks can use different layouts)
  for (let i = 1; i < weeks.length; i++) {
    const before = weeks[i - 1];
    const cur = weeks[i];
    const lastLong = before.workouts.filter((w) => w.role === 'L' || w.role === 'M').map((w) => w.date).sort().pop();
    const clash = lastLong && cur.workouts.find((w) => (w.role === 'Q1' || w.role === 'Q2' || w.role === 'L') && w.date === addDays(lastLong, 1));
    if (!clash || clash.role === 'L') continue;
    const hardDates = cur.workouts.filter((w) => ['Q1', 'Q2', 'L', 'M'].includes(w.role) && w !== clash).map((w) => w.date);
    if (i === weeks.length - 1) hardDates.push(raceDate);
    const swap = cur.workouts.find((w) => (w.role === 'E' || w.role === 'R') && w.date !== addDays(raceDate, -1) && hardDates.every((d) => Math.abs(diffDays(d, w.date)) >= 2));
    if (swap) {
      const keep = { date: swap.date, weekday: swap.weekday, id: swap.id, terrain: swap.terrain };
      Object.assign(swap, { date: clash.date, weekday: clash.weekday, id: clash.id, terrain: clash.terrain });
      Object.assign(clash, keep);
      cur.workouts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.role === 'S' ? 1 : -1));
    } else {
      const steps = W.easySteps(round5(Math.min(clash.plannedMin, 40)), { zone: 'Z2' });
      Object.assign(clash, { code: 'EZ', name: W.NAMES.EZ, role: 'E', steps, plannedMin: W.totalMinutes(steps), plannedVertM: 0, plannedKm: trail ? null : Math.round(((W.totalMinutes(steps) * 60) / easyPace) * 10) / 10 });
      const otherQuality = cur.workouts.some((w) => (w.role === 'Q1' || w.role === 'Q2') && w !== clash);
      cur.flags.push(cur.workouts.some((w) => w.code === 'B2B')
        ? `Back-to-back week: the two long runs are the main work, so the ${trail ? 'flat tempo' : 'first quality session'} is an easy run.${otherQuality ? ' The other quality session stays.' : ''}`
        : 'A quality session became an easy run because it would have followed the long run directly.');
    }
    const rw = cur.workouts.filter((w) => w.role !== 'S' && w.role !== 'RACE');
    cur.plannedMin = rw.reduce((x, w) => x + w.plannedMin, 0);
    cur.plannedVertM = rw.reduce((x, w) => x + (w.plannedVertM ?? 0), 0);
    if (!trail) cur.plannedKm = Math.round(rw.reduce((x, w) => x + (w.plannedKm ?? 0), 0) * 10) / 10;
  }
  const shakeAvailable = available.includes(weekdayOf(dayBefore));
  if (prevWeek && !shakeAvailable) prevWeek.flags.push('No shakeout run: the day before the race is marked unavailable.');
  if (prevWeek && shakeAvailable) {
    const existing = prevWeek.workouts.find((w) => w.date === dayBefore && w.role !== 'S');
    const steps = W.shakeoutSteps();
    if (existing?.role === 'L') prevWeek.flags.push('The race is the day after your long-run day, so that long run became the shakeout. A different long-run day keeps it.');
    if (existing) {
      Object.assign(existing, { code: 'SHK', name: W.NAMES.SHK, role: 'E', steps, plannedMin: W.totalMinutes(steps), plannedVertM: 0, plannedKm: trail ? null : 3 });
    } else {
      prevWeek.workouts.push({ id: `w${prevWeek.n}-${weekdayOf(dayBefore)}-SHK`, date: dayBefore, weekday: weekdayOf(dayBefore), week: prevWeek.n, code: 'SHK', name: W.NAMES.SHK, role: 'E', terrain: 'flat', steps, plannedMin: W.totalMinutes(steps), plannedKm: trail ? null : 3, plannedVertM: 0, notes: [], locked: false });
      prevWeek.workouts.sort((a, b) => (a.date < b.date ? -1 : 1));
    }
    const rw = prevWeek.workouts.filter((w) => w.role !== 'S' && w.role !== 'RACE');
    prevWeek.plannedMin = rw.reduce((x, w) => x + w.plannedMin, 0);
    prevWeek.plannedVertM = rw.reduce((x, w) => x + (w.plannedVertM ?? 0), 0);
    if (!trail) prevWeek.plannedKm = Math.round(rw.reduce((x, w) => x + (w.plannedKm ?? 0), 0) * 10) / 10;
  }
  {
    const rw = last.workouts.filter((w) => w.role !== 'S' && w.role !== 'RACE');
    last.plannedMin = rw.reduce((x, w) => x + w.plannedMin, 0);
    last.plannedVertM = rw.reduce((x, w) => x + (w.plannedVertM ?? 0), 0);
    if (!trail) last.plannedKm = Math.round(rw.reduce((x, w) => x + (w.plannedKm ?? 0), 0) * 10) / 10;
  }
  last.workouts.push({
    id: `race`, date: raceDate, weekday: raceWeekday, week: last.n, code: 'RACE', name: trail ? `Race: ${race.distanceKm} km, ${race.elevationGainM} m` : `Race: ${race.distanceKm} km`, role: 'RACE', terrain: trail ? 'hills' : 'flat',
    steps: [], plannedMin: trail ? Math.round(params.TrMin) : Math.round(params.predictedSec / 60), plannedKm: race.distanceKm, plannedVertM: trail ? race.elevationGainM : 0, notes: [], locked: false,
  });

  // Entry check, second half: does the plan reach the starting point early enough to leave a full block?
  const entryNeed = trail ? params.cls.entry : params.table.entry; // [weekly hours, longest run hours] or [weekly km, longest run km]
  let entryLeadWeeks = null;
  if (entryNeed && messages.some((m) => m.code === 'entry')) {
    const minBlock = trail ? params.cls.block : params.table.block;
    const trainWeeks = nWeeks - (params.earlyRace ? 1 : 0);
    let bestVol = 0, bestLong = 0, reached = null;
    for (const w of weeks) {
      bestVol = Math.max(bestVol, trail ? w.targetHours : w.targetKm);
      const long = w.workouts.find((x) => x.role === 'L');
      if (long) bestLong = Math.max(bestLong, trail ? long.plannedMin / 60 : long.plannedKm ?? 0);
      if (bestVol >= entryNeed[0] && bestLong >= 0.9 * entryNeed[1]) { reached = w.n; break; }
    }
    if (reached != null && trainWeeks - reached >= minBlock) entryLeadWeeks = reached;
    const i = messages.findIndex((m) => m.code === 'entry');
    if (entryLeadWeeks != null) {
      const need = trail ? `about ${entryNeed[0]} h a week with a longest run of ${entryNeed[1]} h` : `${entryNeed[0]} km a week with a longest run of ${entryNeed[1]} km`;
      messages[i] = { level: 'warn', code: 'entryBase', text: `You are below the usual starting point for this race (${need}), but there is time to get there: weeks 1 to ${entryLeadWeeks} build that base, which leaves ${trainWeeks - entryLeadWeeks} weeks of race-specific training. Take those first weeks patiently and cut back at any sign of injury.` };
    } else if (entryPending && !overrideEntry) {
      return { status: 'BLOCK', messages: strict.messages, plan: null };
    }
  }

  const coverage = coverageOf(weeks, trail);
  const climbDays = available.filter((d) => terrain[d] === 'hills' || terrain[d] === 'incline');
  if (!noRunAdvice && trail && coverage.worst < COVERAGE_MIN && climbDays.length === 0) {
    messages.push({ level: 'warn', code: 'noClimbDays', recommendedRuns: null, text: `None of your available days is set to hills or incline, so only ${Math.round(coverage.worst * 100)}% of the climbing target can be placed. More runs will not fix this. Set at least one weekday to incline or hills in Settings, Schedule.` });
  } else if (!noRunAdvice && coverage.worst < COVERAGE_MIN) {
    const maxRuns = Math.min(7, available.length);
    let better = null;
    for (let r = v.effectiveRunsPerWeek + 1; r <= maxRuns && !better; r++) {
      const trial = generatePlan({ ...settingsIn, schedule: { ...settingsIn.schedule, runsPerWeek: r } }, history, { today, id, now, allowShort, overrideEntry, noRunAdvice: true, resume });
      if (trial.plan) {
        const c = coverageOf(trial.plan.weeks, trail);
        if (c.worst >= COVERAGE_MIN) better = { runs: r, coverage: c };
      }
    }
    const gaps = coverage.gaps.map((g) => `${g.label} (${Math.round(g.ratio * 100)}% of target)`).join(' and ');
    const fix = better
      ? `Raise runs per week to ${better.runs} to cover it.`
      : maxRuns > v.effectiveRunsPerWeek
        ? `Even ${maxRuns} runs a week does not fully cover it, so consider a later start with more weeks, a longer lead time, or an easier goal.`
        : 'You have no more available days, so free up another day or consider an easier goal.';
    messages.push({ level: 'warn', code: 'runsTooFew', recommendedRuns: better?.runs ?? null, text: `${v.effectiveRunsPerWeek} runs a week is not enough to reach this goal: ${gaps}. ${fix}` });
  }
  // Weeks that still run well over their target: the shortest useful sessions do not fit a week this small.
  for (const w of weeks) {
    if (w.n === nWeeks || w.kind === 'hold') continue;
    const over = trail ? w.plannedMin - w.targetHours * 60 : (w.plannedKm ?? 0) - (w.targetKm ?? 0);
    const target = trail ? w.targetHours * 60 : w.targetKm ?? 0;
    if (target > 0 && over > 0.15 * target && over > (trail ? 15 : 2)) {
      w.flags.push(`This week is ${trail ? `${Math.round(over)} min` : `${Math.round(over * 10) / 10} km`} over its target because the shortest useful sessions do not fit a week this small. Run the easy parts shorter if it feels like too much.`);
    }
  }

  // Not a real training block: far too few weeks, or a peak that stays far below what the race needs.
  {
    const minBlock = trail ? params.cls.block : params.table.block;
    const trainWeeks = nWeeks - (params.earlyRace ? 1 : 0);
    const peakReached = Math.max(0, ...weeks.filter((w) => w.kind !== 'taper').map((w) => (trail ? w.targetHours : w.targetKm ?? 0)));
    const peakNeeded = trail ? params.peakHours : params.peakKm;
    const share = peakNeeded > 0 ? peakReached / peakNeeded : 1;
    const label = trail ? `a ${settings.race.distanceKm} km trail race with ${settings.race.elevationGainM} m climbing` : `a ${params.table.label}`;
    // a 5 km or 10 km can be finished from a small base, so only longer races are judged by volume
    const longRace = trail ? params.effort > 25 : params.cat === 'half' || params.cat === 'marathon';
    const lowPeak = longRace && share < 0.4;
    if (trainWeeks < minBlock / 2 || lowPeak) {
      const why = [
        trainWeeks < minBlock / 2 ? `only ${trainWeeks} week${trainWeeks === 1 ? '' : 's'} until the race, where ${minBlock} is the minimum` : null,
        lowPeak ? `the weekly volume peaks at ${Math.round(100 * share)}% of what ${label} needs` : null,
      ].filter(Boolean).join(', and ');
      // a predicted race time assumes the training was done, so say so
      for (const m of messages) if (m.code === 'predicted') m.text = `${m.text.replace(/\.$/, '')}, but only if you were trained for the distance.`;
      messages.unshift({
        level: 'warn', code: 'notABlock',
        text: `This is not a real training block: ${why}. The plan can keep you running safely up to race day, but it cannot prepare you for this race. A later race or a shorter one would suit your current training better. If you do start, run it as an easy effort and be ready to stop.`,
      });
    }
  }

  const finalStatus = messages.some((m) => m.level === 'warn') ? 'WARN' : 'OK';

  const plan = {
    id, createdAt: now ?? null, mode: trail ? 'trail' : 'road', status: finalStatus, entryOverridden: Boolean(overrideEntry && entryLeadWeeks == null && messages.some((m) => m.code === 'entry')), entryLeadWeeks,
    race: { ...race, kmEffort: trail ? params.effort : null, expectedDurationMin: trail ? params.TrRange : null, predictedSec: trail ? null : params.predictedSec },
    goalPaceSecPerKm: goalPace, easyPaceSecPerKm: easyPace, startDate: params.startMonday, raceDate,
    phases: vol.phases, peak: { km: vol.peakKm, hours: vol.peakHours, vertM: vol.peakVertM, longRunMin: params.peakLongMin ?? null, longRunKm: params.peakLong ?? null },
    easyPaceSecPerKm: trail ? null : easyPace,
    messages, // kept with the plan so the warnings are still shown after a reload
    settingsSnapshot: { runsPerWeek: v.effectiveRunsPerWeek, longRunDay: schedule.longRunDay, dayTerrain: terrain, unavailableDays: schedule.unavailableDays ?? [], experience: settings.athlete.experience },
    weeks,
  };
  return { status: finalStatus, messages, plan };
}
