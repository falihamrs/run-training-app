// Property checks over a grid of settings: every generated plan must satisfy these, whatever the inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan } from '../js/core/plan/generate.js';
import * as W from '../js/core/plan/workouts.js';
import { WEEKDAYS, addDays, diffDays, weekdayOf } from '../js/core/dates.js';
import { TERRAIN, hist, settingsFor } from './helpers/plan.js';

const FLAT = Object.fromEntries(WEEKDAYS.map((d) => [d, 'flat']));
const RACES = [{ distanceKm: 5 }, { distanceKm: 21.1 }, { distanceKm: 42.195 }, { mode: 'trail', distanceKm: 15, gain: 600 }, { mode: 'trail', distanceKm: 25, gain: 2300 }];
const HISTS = [hist(), hist({ baselineWeeklyKm: 10, baselineWeeklyHours: 1.1, longestRunKm: 6, longestRunMin: 45, baselineWeeklyVertM: 30 }), hist({ baselineWeeklyKm: 60, baselineWeeklyHours: 7, longestRunKm: 25, longestRunMin: 200, baselineWeeklyVertM: 1500 })];
const HARD = new Set(['Q1', 'Q2', 'L', 'RACE']);

function* cases() {
  for (const rc of RACES) for (const runs of [3, 4, 6]) for (const weeks of [6, 16, 32]) for (const shift of [0, -1, -5]) for (const h of HISTS) for (const unavailable of [[], ['Mon', 'Thu']]) {
    const terrains = rc.mode === 'trail' ? [TERRAIN, FLAT] : [TERRAIN];
    for (const terrain of terrains) {
      const s = settingsFor({ ...rc, runs, weeks, terrain, unavailable });
      s.race.date = addDays(s.race.date, shift);
      yield { s, h, unavailable, runs, label: `${rc.mode ?? 'road'} ${rc.distanceKm} km, ${runs} runs, ${weeks} wk, race ${weekdayOf(s.race.date)}, unavailable ${unavailable.join('/') || 'none'}` };
    }
  }
}

test('every generated plan satisfies the structural invariants', () => {
  let n = 0;
  for (const c of cases()) {
    const r = generatePlan(c.s, c.h, { today: '2026-12-28', overrideEntry: true, allowShort: true });
    assert.ok(r.plan, `${c.label}: ${r.messages.map((m) => m.text).join(' ')}`);
    n++;
    const p = r.plan;
    const ids = new Set();
    const maxRuns = Math.min(c.runs, 7 - c.unavailable.length);
    for (const w of p.weeks) {
      const runW = w.workouts.filter((x) => x.role !== 'S' && x.role !== 'RACE');
      assert.equal(w.plannedMin, runW.reduce((a, x) => a + x.plannedMin, 0), `${c.label} W${w.n}: week total`);
      assert.ok(runW.length <= maxRuns, `${c.label} W${w.n}: ${runW.length} runs`);
      for (const x of w.workouts) {
        assert.ok(!ids.has(x.id), `${c.label}: duplicate id ${x.id}`); ids.add(x.id);
        assert.ok(x.date <= p.raceDate, `${c.label}: ${x.id} after the race`);
        if (x.role !== 'RACE') {
          assert.ok(!c.unavailable.includes(x.weekday), `${c.label}: ${x.id} on an unavailable day`);
          const off = diffDays(w.start, x.date);
          assert.ok(off >= 0 && off <= 6, `${c.label}: ${x.id} outside its week`);
        }
        if (x.role !== 'RACE' && x.role !== 'S') {
          assert.equal(W.totalMinutes(x.steps), x.plannedMin, `${c.label}: ${x.id} steps vs minutes`);
          assert.ok(x.plannedMin >= 15, `${c.label}: ${x.id} only ${x.plannedMin} min`);
          if (x.plannedVertM) assert.ok(x.plannedVertM <= (400 * x.plannedMin) / 60 + 0.5, `${c.label}: ${x.id} climbs too steeply`);
        }
      }
      const long = w.workouts.find((x) => x.role === 'L');
      if (long) for (const x of runW) if (x.role === 'E' || x.role === 'R') assert.ok(x.plannedMin <= long.plannedMin + 10, `${c.label} W${w.n}: easy run longer than the long run`);
      const okFlag = w.flags.some((f) => /left out|became the shakeout|run was dropped/.test(f));
      if (w.n < p.weeks.length && w.phase !== 'taper' && !okFlag) {
        if (p.mode === 'trail') assert.ok(w.plannedMin <= w.targetHours * 60 * 1.15 + 5 && w.plannedMin >= w.targetHours * 60 * 0.8, `${c.label} W${w.n}: ${w.plannedMin} min vs ${w.targetHours} h`);
        else assert.ok(w.plannedKm >= w.targetKm * 0.8, `${c.label} W${w.n}: ${w.plannedKm} vs ${w.targetKm} km`);
      }
    }
    const hard = p.weeks.flatMap((w) => w.workouts).filter((x) => HARD.has(x.role)).sort((a, b) => (a.date < b.date ? -1 : 1));
    for (let i = 1; i < hard.length; i++) assert.ok(diffDays(hard[i - 1].date, hard[i].date) >= 2, `${c.label}: ${hard[i - 1].id} then ${hard[i].id}`);
    assert.equal(p.weeks.at(-1).workouts.filter((x) => x.role === 'RACE').length, 1);
    const shk = p.weeks.flatMap((w) => w.workouts).filter((x) => x.code === 'SHK');
    assert.ok(shk.length <= 1 && shk.every((x) => x.date === addDays(p.raceDate, -1)), `${c.label}: shakeout`);
  }
  assert.ok(n > 500);
});
