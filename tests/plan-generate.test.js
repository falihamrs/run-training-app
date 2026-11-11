import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan } from '../js/core/plan/generate.js';
import { WEEKDAYS, addDays, diffDays } from '../js/core/dates.js';
import { TERRAIN, hist, settingsFor } from './helpers/plan.js';

const TODAY = '2026-12-28';
const gen = (o, h) => generatePlan(settingsFor(o), hist(h), { today: TODAY });
const trailOpts = { mode: 'trail', distanceKm: 42, gain: 2500, terrain: TERRAIN };
const runs = (week) => week.workouts.filter((w) => w.role !== 'S' && w.role !== 'RACE');
const HARD = ['L', 'Q1', 'Q2'];

test('blocked inputs return no plan', () => {
  const r = gen({ weeks: 8 });
  assert.equal(r.status, 'BLOCK');
  assert.equal(r.plan, null);
});

test('scenario 1: marathon plan is OK, 16 weeks, 5 runs a week, volumes near target', () => {
  const r = gen({});
  assert.equal(r.status, 'OK');
  const p = r.plan;
  assert.equal(p.weeks.length, 16);
  for (const w of p.weeks.slice(0, 13)) {
    assert.equal(runs(w).length, 5, `week ${w.n}`);
    assert.ok(Math.abs(w.plannedKm - w.targetKm) / w.targetKm < 0.12, `week ${w.n}: ${w.plannedKm} vs ${w.targetKm}`);
  }
});

test('plan is deterministic', () => {
  assert.equal(JSON.stringify(gen({}).plan), JSON.stringify(gen({}).plan));
});

test('hard sessions are never on adjacent days and down weeks have no hard Q2', () => {
  for (const opts of [{}, trailOpts, { runs: 4 }, { runs: 6 }, { ...trailOpts, runs: 4 }]) {
    const p = gen(opts).plan;
    for (const w of p.weeks) {
      const hard = runs(w).filter((x) => HARD.includes(x.role)).map((x) => x.date);
      for (let i = 0; i < hard.length; i++) for (let j = i + 1; j < hard.length; j++) assert.ok(Math.abs(diffDays(hard[i], hard[j])) > 1, `week ${w.n}`);
      // road down weeks drop Q2; trail down weeks keep a light climbing session without intervals
      if (w.kind === 'down') assert.ok(!runs(w).some((x) => x.role === 'Q2' && x.steps.some((s) => s.kind === 'repeat')), `down week ${w.n} has a hard Q2`);
    }
  }
});

test('long run grows by at most 2 km and stays within the cap', () => {
  const p = gen({}).plan;
  let prev = 14;
  for (const w of p.weeks.filter((x) => x.kind === 'load' || x.kind === 'down')) {
    const l = w.workouts.find((x) => x.role === 'L');
    assert.ok(l.plannedKm <= 32.5, `week ${w.n} long ${l.plannedKm}`);
    if (w.kind === 'load') { assert.ok(l.plannedKm <= prev + 2.6, `week ${w.n}`); prev = Math.max(prev, l.plannedKm); }
  }
});

test('race day, shakeout the day before and nothing after', () => {
  const p = gen({}).plan;
  const all = p.weeks.flatMap((w) => w.workouts);
  const race = all.find((x) => x.code === 'RACE');
  assert.equal(race.date, p.raceDate);
  assert.equal(all.filter((x) => x.date > p.raceDate).length, 0);
  assert.equal(all.find((x) => diffDays(x.date, p.raceDate) === 1 && x.role !== 'S').code, 'SHK');
});

test('marathon peak has marathon-pace long runs and no quality work in the final week beyond one short session', () => {
  const p = gen({}).plan;
  assert.ok(p.weeks.some((w) => w.workouts.some((x) => x.code === 'LRM')));
  const last = p.weeks.at(-1);
  assert.ok(runs(last).filter((x) => x.role === 'Q1').length <= 1);
  assert.equal(last.workouts.filter((x) => x.role === 'S').length, 0);
});

test('workouts store zones, never absolute paces', () => {
  const json = JSON.stringify(gen({}).plan.weeks);
  assert.ok(!/paceSecPerKm|"pace"|bpm/.test(json));
});

test('scenario 7: five runs requested with three days available', () => {
  const r = gen({ unavailable: ['Mon', 'Wed', 'Fri', 'Sat'] });
  assert.ok(r.messages.some((m) => m.code === 'runsReduced'));
  assert.equal(runs(r.plan.weeks[2]).length, 3);
});

test('strength: placed away from hard days, spaced, none in race week', () => {
  const p = gen(trailOpts).plan;
  for (const w of p.weeks) {
    const s = w.workouts.filter((x) => x.role === 'S');
    const hardDays = runs(w).filter((x) => HARD.includes(x.role)).map((x) => WEEKDAYS.indexOf(x.weekday));
    for (const x of s) {
      const i = WEEKDAYS.indexOf(x.weekday);
      assert.ok(!hardDays.includes(i) && !hardDays.includes((i + 1) % 7), `week ${w.n} strength ${x.weekday}`);
    }
    if (s.length === 2) assert.ok(Math.abs(WEEKDAYS.indexOf(s[0].weekday) - WEEKDAYS.indexOf(s[1].weekday)) >= 2);
  }
  assert.equal(p.weeks.at(-1).workouts.filter((x) => x.role === 'S').length, 0);
  assert.ok(p.weeks[0].workouts.filter((x) => x.role === 'S').length >= 1);
});

test('scenario 9 (generator): trail plan shape', () => {
  const r = gen(trailOpts);
  assert.equal(r.status, 'OK');
  const p = r.plan;
  assert.equal(p.weeks.length, 16);
  assert.equal(p.weeks[13].targetVertM, 1450);
  for (const w of p.weeks.filter((x) => x.kind === 'load')) {
    assert.ok(Math.abs(w.plannedVertM - w.targetVertM) <= Math.max(60, 0.1 * w.targetVertM), `week ${w.n}: ${w.plannedVertM} vs ${w.targetVertM}`);
    assert.ok(Math.abs(w.plannedMin - w.targetHours * 60) / (w.targetHours * 60) < 0.1, `week ${w.n} minutes`);
  }
  const long = p.weeks.flatMap((w) => w.workouts).filter((x) => x.role === 'L');
  assert.ok(long.every((x) => x.plannedMin <= 270));
});

test('trail: no session exceeds 400 m of climbing per hour', () => {
  for (const w of gen(trailOpts).plan.weeks) for (const x of w.workouts) if (x.plannedVertM) assert.ok(x.plannedVertM <= (400 * x.plannedMin) / 60 + 15, `${x.id}`);
});

test('scenario 10 (generator): low climbing baseline warns', () => {
  const r = gen(trailOpts, { baselineWeeklyVertM: 250 });
  assert.equal(r.status, 'WARN');
});

test('scenario 13: every day flat, no incline: climbing flagged each loading week', () => {
  const flat = Object.fromEntries(WEEKDAYS.map((d) => [d, 'flat']));
  const r = gen({ ...trailOpts, terrain: flat });
  const loading = r.plan.weeks.filter((w) => w.kind === 'load' && w.phase !== 'taper');
  assert.ok(loading.every((w) => w.flags.some((f) => /climbing/.test(f))));
});

test('scenario 14: weekend hills only: back-to-back long run Saturday, medium Sunday, Q1 on a flat weekday', () => {
  const terrain = Object.fromEntries(WEEKDAYS.map((d) => [d, d === 'Sat' || d === 'Sun' ? 'hills' : 'flat']));
  const p = gen({ ...trailOpts, terrain }).plan;
  const b2b = p.weeks.find((w) => w.workouts.some((x) => x.code === 'B2B'));
  assert.ok(b2b, 'a back-to-back week exists');
  assert.equal(b2b.workouts.find((x) => x.code === 'B2B').weekday, 'Sat');
  assert.equal(b2b.workouts.find((x) => x.code === 'MED').weekday, 'Sun');
  assert.equal(b2b.phase, 'peak');
  const q1 = b2b.workouts.find((x) => x.role === 'Q1');
  assert.equal(terrain[q1.weekday], 'flat');
  const q2 = p.weeks.flatMap((w) => w.workouts).filter((x) => x.role === 'Q2');
  assert.ok(q2.every((x) => ['INC', 'TMP', 'HIL', 'CLB', 'HIKE', 'DWN'].includes(x.code)));
});

test('trail phases: base fartlek, build tempo, peak simulation, taper short tempo', () => {
  const p = gen(trailOpts).plan;
  const codes = (phase) => new Set(p.weeks.filter((w) => w.phase === phase).flatMap((w) => w.workouts.map((x) => x.code)));
  assert.ok(codes('base').has('FAR'));
  assert.ok(codes('build').has('TMP'));
  assert.ok(codes('peak').has('SIM') && codes('peak').has('B2B'));
  assert.ok(codes('taper').has('SHK'));
});

test('road tune: 10 km plan builds with race-pace work in the peak', () => {
  const p = gen({ distanceKm: 10, weeks: 12, goal: 50 * 60, runs: 4, thresholds: [{ effectiveFrom: '2027-01-04', lthr: 170, paceSecPerKm: 285, source: 'manual' }] }, { baselineWeeklyKm: 25, longestRunKm: 10 }).plan;
  assert.ok(p.weeks.some((w) => w.phase === 'peak' && w.workouts.some((x) => x.code === 'RP')));
  assert.equal(p.weeks.length, 12);
});

test('plans longer than 24 weeks start with held weeks', () => {
  const p = gen({ weeks: 30 }).plan;
  assert.equal(p.weeks.length, 30);
  assert.equal(p.weeks[0].kind, 'hold');
});

test('a low baseline blocks a mid-size trail race unless the entry check is overridden', () => {
  const s = settingsFor({ mode: 'trail', distanceKm: 24, gain: 1100, terrain: TERRAIN, runs: 3, weeks: 11 });
  const low = hist({ baselineWeeklyHours: 2, baselineWeeklyVertM: 60, longestRunMin: 80 });
  assert.equal(generatePlan(s, low, { today: TODAY }).status, 'BLOCK');
  const r = generatePlan(s, low, { today: TODAY, overrideEntry: true });
  assert.equal(r.status, 'WARN');
  assert.ok(r.plan);
  assert.ok(r.messages.some((m) => m.code === 'entry' && m.level === 'warn'));
});

test('too few runs a week for the climbing target recommends more runs', () => {
  const o = { mode: 'trail', distanceKm: 25, gain: 2300, terrain: TERRAIN, weeks: 24, runs: 3 };
  const r = gen(o, { baselineWeeklyHours: 4, longestRunMin: 120, baselineWeeklyVertM: 400 });
  const w = r.messages.find((m) => m.code === 'runsTooFew');
  if (w) {
    assert.ok(w.recommendedRuns === null || w.recommendedRuns > 3);
    assert.match(w.text, /runs a week is not enough/);
  }
  const more = gen({ ...o, runs: 5 }, { baselineWeeklyHours: 4, longestRunMin: 120, baselineWeeklyVertM: 400 });
  assert.ok(!more.messages.some((m) => m.code === 'runsTooFew' && m.recommendedRuns !== null));
});

test('trail weeks stay close to their time target and race week keeps the run count', () => {
  const r = gen({ ...trailOpts, distanceKm: 25, gain: 2300, runs: 4, weeks: 24 }, { baselineWeeklyHours: 4, longestRunMin: 120, baselineWeeklyVertM: 400 });
  assert.ok(r.plan);
  const weeks = r.plan.weeks;
  for (const w of weeks.slice(0, -1)) {
    const target = w.targetHours * 60;
    assert.ok(w.plannedMin <= target * 1.12 + 5 && w.plannedMin >= target * 0.8, `week ${w.n}: ${w.plannedMin} vs ${target}`);
  }
  const last = weeks[weeks.length - 1];
  assert.ok(last.workouts.filter((x) => x.role !== 'S' && x.role !== 'RACE').length <= 4);
  assert.equal(last.plannedMin, last.workouts.filter((x) => x.role !== 'S' && x.role !== 'RACE').reduce((s, x) => s + x.plannedMin, 0));
});

test('no hills or incline day: advice is to set terrain, not to add runs', () => {
  const flat = Object.fromEntries(WEEKDAYS.map((d) => [d, 'flat']));
  const r = gen({ ...trailOpts, distanceKm: 25, gain: 2300, runs: 4, weeks: 24, terrain: flat }, { baselineWeeklyHours: 4, longestRunMin: 120, baselineWeeklyVertM: 400 });
  assert.ok(r.messages.some((m) => m.code === 'noClimbDays'));
  assert.ok(!r.messages.some((m) => m.code === 'runsTooFew'));
});

test('very low baseline: early weeks stay near the time target by using fewer runs', () => {
  const r = generatePlan(settingsFor({ ...trailOpts, distanceKm: 25, gain: 2300, runs: 4, weeks: 32 }), hist({ baselineWeeklyHours: 1.1, longestRunMin: 80, baselineWeeklyVertM: 40 }), { today: TODAY, overrideEntry: true });
  assert.ok(r.plan);
  const first = r.plan.weeks[0];
  assert.ok(first.plannedMin <= first.targetHours * 60 * 1.1 + 1, `${first.plannedMin} vs ${first.targetHours * 60}`);
  assert.ok(first.workouts.filter((w) => w.role !== 'S').length >= 2);
});

test('low weekly time still ramps up instead of rounding back to the same value', () => {
  const r = generatePlan(settingsFor({ ...trailOpts, distanceKm: 25, gain: 2300, runs: 4, weeks: 16 }), hist({ baselineWeeklyHours: 1.1, longestRunMin: 45, baselineWeeklyVertM: 30 }), { today: TODAY, overrideEntry: true });
  const hours = r.plan.weeks.map((w) => w.targetHours);
  assert.ok(Math.max(...hours) >= hours[0] + 2, `targets stayed flat: ${hours.join(',')}`);
  const road = generatePlan(settingsFor({ distanceKm: 10, runs: 3, weeks: 16 }), hist({ baselineWeeklyKm: 6 }), { today: TODAY, overrideEntry: true, allowShort: true });
  const km = road.plan.weeks.map((w) => w.targetKm);
  assert.ok(Math.max(...km) > km[0] + 5, `road targets stayed flat: ${km.join(',')}`);
});

test('no easy run is longer than the long run, and the lost time is flagged', () => {
  const r = generatePlan(settingsFor({ ...trailOpts, distanceKm: 15, gain: 600, runs: 4, weeks: 32 }), hist({ baselineWeeklyHours: 7, longestRunMin: 200, baselineWeeklyVertM: 1500 }), { today: TODAY, overrideEntry: true });
  for (const w of r.plan.weeks) {
    const long = w.workouts.find((x) => x.role === 'L');
    if (!long) continue;
    for (const x of w.workouts) if (x.role === 'E' || x.role === 'R') assert.ok(x.plannedMin <= long.plannedMin + 10, `week ${w.n}: ${x.code} ${x.plannedMin} > long ${long.plannedMin}`);
  }
  assert.ok(r.plan.weeks[0].flags.some((f) => /left out/.test(f)));
});

test('no shakeout on an unavailable day, and no hard session the day after a long run', () => {
  const s = settingsFor({ distanceKm: 10, runs: 3, weeks: 6, unavailable: ['Mon', 'Thu'] });
  s.race.date = addDays(s.race.date, -5); // a Tuesday
  const r = generatePlan(s, hist(), { today: TODAY, overrideEntry: true, allowShort: true });
  const all = r.plan.weeks.flatMap((w) => w.workouts);
  assert.ok(!all.some((w) => w.code === 'SHK'));
  assert.ok(all.every((w) => w.role === 'RACE' || !['Mon', 'Thu'].includes(w.weekday)));
  const t = generatePlan(settingsFor({ ...trailOpts, distanceKm: 15, gain: 600, runs: 5, weeks: 6 }), hist(), { today: TODAY, overrideEntry: true, allowShort: true });
  const hard = t.plan.weeks.flatMap((w) => w.workouts).filter((w) => ['Q1', 'Q2', 'L', 'RACE'].includes(w.role)).sort((a, b) => (a.date < b.date ? -1 : 1));
  for (let i = 1; i < hard.length; i++) assert.ok(diffDays(hard[i - 1].date, hard[i].date) >= 2, `${hard[i - 1].id} then ${hard[i].id}`);
});

test('climbing never exceeds 400 m per hour in any session', () => {
  for (const h of [hist(), hist({ baselineWeeklyHours: 7, longestRunMin: 200, baselineWeeklyVertM: 1500 }), hist({ baselineWeeklyHours: 1.1, longestRunMin: 45, baselineWeeklyVertM: 30 })]) {
    const r = generatePlan(settingsFor({ ...trailOpts, distanceKm: 25, gain: 2300, runs: 4, weeks: 24 }), h, { today: TODAY, overrideEntry: true });
    for (const w of r.plan.weeks.flatMap((x) => x.workouts)) if (w.role !== 'RACE' && w.plannedVertM) assert.ok(w.plannedVertM <= (400 * w.plannedMin) / 60 + 0.5, `${w.id} ${w.plannedVertM} m in ${w.plannedMin} min`);
  }
});

test('a Monday race still gets a taper: the week before is race-like and ends with the shakeout', () => {
  for (const o of [{ distanceKm: 10, runs: 5, weeks: 10 }, { ...trailOpts, distanceKm: 15, gain: 600, runs: 4, weeks: 10 }]) {
    const s = settingsFor(o);
    s.race.date = addDays(s.race.date, -6); // a Monday
    const p = generatePlan(s, hist(), { today: TODAY, overrideEntry: true, allowShort: true }).plan;
    const prep = p.weeks.at(-2);
    const peakMin = Math.max(...p.weeks.map((w) => w.plannedMin));
    assert.equal(prep.phase, 'taper');
    assert.ok(prep.plannedMin <= 0.8 * peakMin, `${prep.plannedMin} vs peak ${peakMin}`);
    assert.ok(!prep.workouts.some((w) => w.role === 'L'));
    assert.equal(prep.workouts.filter((w) => w.role !== 'S').at(-1).code, 'SHK');
    assert.deepEqual(p.weeks.at(-1).workouts.map((w) => w.code), ['RACE']);
  }
});

test('the 5 km and 10 km taper session has one warm-up and one cool-down', () => {
  const p = generatePlan(settingsFor({ distanceKm: 5, runs: 5, weeks: 8 }), hist(), { today: TODAY }).plan;
  const q = p.weeks.at(-1).workouts.find((w) => w.code === 'RP');
  assert.ok(q);
  assert.equal(q.steps.filter((s) => s.kind === 'cooldown').length, 1);
  assert.equal(q.steps.filter((s) => s.kind === 'warmup').length, 1);
});

test('long plans hold the baseline only for weeks the ramp does not need', () => {
  const low = generatePlan(settingsFor({ ...trailOpts, distanceKm: 25, gain: 2300, runs: 4, weeks: 32 }), hist({ baselineWeeklyHours: 1.25, longestRunMin: 60, baselineWeeklyVertM: 40 }), { today: TODAY, overrideEntry: true }).plan;
  const holdLow = low.weeks.filter((w) => w.kind === 'hold').length;
  assert.ok(holdLow < 8, `${holdLow} hold weeks`);
  const firstPeakPhase = low.weeks.find((w) => w.phase === 'peak').n;
  const firstAtPeak = low.weeks.find((w) => w.targetHours >= low.peak.hours).n;
  assert.ok(firstAtPeak <= firstPeakPhase, `peak hours first reached in week ${firstAtPeak}, peak phase starts in week ${firstPeakPhase}`);
  const fit = generatePlan(settingsFor({ ...trailOpts, distanceKm: 25, gain: 2300, runs: 5, weeks: 32 }), hist({ baselineWeeklyHours: 6, longestRunMin: 200, baselineWeeklyVertM: 1500 }), { today: TODAY }).plan;
  assert.equal(fit.weeks.filter((w) => w.kind === 'hold').length, 8);
});

test('plans of one or two weeks still produce finite targets', () => {
  for (const weeks of [1, 2, 3]) {
    const p = generatePlan(settingsFor({ distanceKm: 42.195, runs: 4, weeks }), hist(), { today: TODAY, overrideEntry: true, allowShort: true }).plan;
    assert.ok(p, `no plan for ${weeks} weeks`);
    for (const w of p.weeks) assert.ok(Number.isFinite(w.targetKm) && Number.isFinite(w.plannedMin), `week ${w.n}`);
    assert.equal(p.weeks.at(-1).phase, 'taper');
  }
});

test('warnings are stored with the plan', () => {
  const r = generatePlan(settingsFor({ ...trailOpts, distanceKm: 25, gain: 2300, runs: 4, weeks: 20 }), hist({ baselineWeeklyHours: 1.1, longestRunMin: 45 }), { today: TODAY, overrideEntry: true });
  assert.ok(r.plan.messages.some((m) => m.code === 'entry'));
  assert.equal(r.plan.entryOverridden, true);
});

test('below the starting point: enough weeks build the base first, too few weeks are refused', () => {
  const low = hist({ baselineWeeklyHours: 1.9, longestRunMin: 80, baselineWeeklyVertM: 60 });
  const long = generatePlan(settingsFor({ ...trailOpts, distanceKm: 25, gain: 2300, runs: 4, weeks: 32 }), low, { today: TODAY });
  assert.ok(long.plan, long.messages.map((m) => m.text).join(' '));
  assert.equal(long.plan.entryOverridden, false);
  assert.ok(long.plan.entryLeadWeeks >= 5 && long.plan.entryLeadWeeks <= 20);
  assert.ok(long.messages.some((m) => m.code === 'entryBase') && !long.messages.some((m) => m.code === 'entry'));
  // the week named in the message really is at the starting point: 4 h a week and a long run near 2 h
  const upTo = long.plan.weeks.slice(0, long.plan.entryLeadWeeks);
  assert.ok(Math.max(...upTo.map((w) => w.targetHours)) >= 4);
  assert.ok(Math.max(...upTo.flatMap((w) => w.workouts.filter((x) => x.role === 'L').map((x) => x.plannedMin))) >= 108);
  assert.ok(long.plan.weeks.length - long.plan.entryLeadWeeks >= 12);
  // 16 weeks is not enough to build the base and still have a 12-week block
  const short = generatePlan(settingsFor({ ...trailOpts, distanceKm: 25, gain: 2300, runs: 4, weeks: 16 }), low, { today: TODAY });
  assert.equal(short.status, 'BLOCK');
  assert.ok(short.messages.some((m) => m.code === 'entry' && m.level === 'block'));
  const forced = generatePlan(settingsFor({ ...trailOpts, distanceKm: 25, gain: 2300, runs: 4, weeks: 16 }), low, { today: TODAY, overrideEntry: true });
  assert.equal(forced.plan.entryOverridden, true);
  // a runner already at the starting point gets no message at all
  const fit = generatePlan(settingsFor({ ...trailOpts, distanceKm: 25, gain: 2300, runs: 5, weeks: 16 }), hist({ baselineWeeklyHours: 5, longestRunMin: 150, baselineWeeklyVertM: 800 }), { today: TODAY });
  assert.ok(!fit.messages.some((m) => m.code === 'entry' || m.code === 'entryBase'));
  assert.equal(fit.plan.entryLeadWeeks, null);
});

test('a plan that is not a real training block says so, and normal plans do not', () => {
  const low = hist({ baselineWeeklyKm: 10, baselineWeeklyHours: 1.1, longestRunKm: 6, longestRunMin: 45, baselineWeeklyVertM: 30 });
  const s = settingsFor({ distanceKm: 42.195, runs: 3, weeks: 6 });
  s.race.date = addDays(s.race.date, -5);
  assert.equal(generatePlan(s, low, { today: TODAY }).status, 'BLOCK');
  const r = generatePlan(s, low, { today: TODAY, allowShort: true, overrideEntry: true });
  assert.equal(r.messages[0].code, 'notABlock');
  assert.match(r.messages[0].text, /only 5 weeks until the race, where 12 is the minimum, and the weekly volume peaks at \d+% of what a marathon needs/);
  assert.match(r.messages.find((m) => m.code === 'predicted').text, /only if you were trained/);
  // the overshooting week is flagged instead of silently over target
  assert.ok(r.plan.weeks.some((w) => w.flags.some((f) => /over its target/.test(f))));
  // a 5 km from a small base, a plan with enough weeks, and your own plan get no such warning
  const ok = [
    generatePlan(settingsFor({ distanceKm: 5, runs: 3, weeks: 8 }), low, { today: TODAY }),
    generatePlan(settingsFor({ distanceKm: 21.1, runs: 4, weeks: 16 }), hist(), { today: TODAY }),
    generatePlan(settingsFor({ ...trailOpts, distanceKm: 25, gain: 2300, runs: 4, weeks: 32 }), hist({ baselineWeeklyHours: 1.9, longestRunMin: 80, baselineWeeklyVertM: 60 }), { today: TODAY }),
  ];
  for (const x of ok) {
    assert.ok(x.plan);
    assert.ok(!x.messages.some((m) => m.code === 'notABlock'), x.messages.map((m) => m.text).join(' '));
  }
});

test('a small road plan never has a run shorter than 15 minutes, even in recovery weeks', () => {
  // found by the fuzzer: a 0.8× recovery long run of 2.5 km at a fast easy pace came out at 14 min
  for (const baselineWeeklyKm of [0, 2, 5]) {
    const s = settingsFor({ runs: 4, distanceKm: 21.1, weeks: 56, experience: 'experienced', pace: 270, unavailable: ['Tue', 'Thu', 'Sun'] });
    s.schedule.longRunDay = 'Wed';
    const r = generatePlan(s, hist({ baselineWeeklyKm, baselineWeeklyHours: 9, longestRunKm: 8, longestRunMin: 122 }), { today: TODAY });
    assert.ok(r.plan, r.messages.map((m) => m.text).join(' '));
    for (const w of r.plan.weeks) for (const x of runs(w)) assert.ok(x.plannedMin >= 15, `base ${baselineWeeklyKm} km: ${x.id} ${x.code} ${x.plannedMin} min`);
  }
});
