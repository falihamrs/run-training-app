import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeActivity } from '../js/core/analyze.js';
import { analyzeHistory, collectEfforts } from '../js/core/history.js';
import { clearManualClimbPatch, kmSplits, manualClimbPatch, splitGains, validateSplitValues } from '../js/core/splits.js';
import { makePoints } from './helpers/synth.js';

// a flat "treadmill" run: no altitude change at all
function treadmill(segments) {
  const points = makePoints(segments).map((p) => ({ ...p, alt: 100 }));
  const r = analyzeActivity({ sport: 'Running', startTime: points[0].t, points }, { tzOffsetMin: 420 });
  assert.ok(r.ok);
  return { run: { id: 1, ...r.run }, stream: r.stream };
}

test('km splits follow the real pace of each kilometre and fold a tiny tail away', () => {
  // 2 km at 6:00/km, then 3.3 km at 5:00/km
  const { run, stream } = treadmill([{ sec: 720, pace: 360, hr: 140 }, { sec: 990, pace: 300, hr: 165 }]);
  const s = kmSplits(run, stream);
  assert.equal(s.length, 6);
  assert.ok(Math.abs(s[0].sec - 360) <= 6 && Math.abs(s[3].sec - 300) <= 6, `${s[0].sec} ${s[3].sec}`);
  assert.ok(Math.abs(s[5].distM - 300) < 5);
  assert.ok(Math.abs(s[0].avgHr - 140) < 1 && Math.abs(s[4].avgHr - 165) < 1);
  assert.ok(Math.abs(s.reduce((a, x) => a + x.sec, 0) - run.movingSec) < 1);
  assert.ok(Math.abs(s.reduce((a, x) => a + x.distM, 0) - run.distanceKm * 1000) < 0.01);
  // without the stream the average pace is used
  const flat = kmSplits(run, null);
  assert.equal(flat.length, 6);
  assert.ok(Math.abs(flat[0].sec - run.movingSec / run.distanceKm) < 1);
  // 5.05 km: the last 50 m joins split 5
  const short = treadmill([{ sec: 1818, pace: 360, hr: 140 }]);
  const t = kmSplits(short.run, short.stream);
  assert.equal(t.length, 5);
  assert.ok(Math.abs(t[4].distM - 1050) < 5);
});

test('incline per split becomes climbing, sustained climbs and corrected efforts', () => {
  // 10 km at 6:00/km, heart rate higher on the hill
  const { run, stream } = treadmill([{ sec: 1080, pace: 360, hr: 140 }, { sec: 1440, pace: 360, hr: 168 }, { sec: 1080, pace: 360, hr: 145 }]);
  assert.equal(Math.round(run.gainM), 0);
  const values = ['', '', '', 8, 8, 8, 8, '', '', ''];
  const patch = manualClimbPatch(run, stream, values, 'pct');
  assert.ok(Math.abs(patch.gainM - 320) < 1, `gain ${patch.gainM}`);
  assert.equal(patch.terrain, 'hilly');
  assert.equal(patch.climbs.length, 1);
  const c = patch.climbs[0];
  assert.ok(Math.abs(c.gradePct - 8) < 0.1 && Math.abs(c.durSec - 1440) <= 12 && Math.abs(c.climbSpeedMh - 800) < 10, JSON.stringify(c));
  assert.ok(Math.abs(c.avgHr - 168) < 2);
  // the hardest 20 minutes are on the hill, so they now count as a climb effort
  assert.ok(patch.efforts.w20.hard.gradePct > 6);
  // the best flat pace must come from a part without incline
  const b = patch.efforts.w20.bestPace;
  // (a window may touch the hill a little: the rule is under 10 m of climbing per km)
  assert.ok(b && (b.startSec + 1200 <= 1080 + 160 || b.startSec >= 2520 - 160), `best flat window starts at ${b?.startSec}`);
  assert.equal(patch.manualClimb.device.gainM, run.gainM);
  // weekly climbing in the history summary picks it up
  const edited = { ...run, ...patch };
  const h = analyzeHistory([edited], { planStart: '2026-03-16', asOf: '2026-03-10', mode: 'trail' });
  assert.ok(Math.abs(h.baselineWeeklyVertM - 320) < 1);
  assert.ok(collectEfforts([edited], 400).lthr.length === 1);
  // editing again keeps the original file values, and removing puts them back
  const again = manualClimbPatch(edited, stream, ['', 2], 'pct');
  assert.equal(again.manualClimb.device.gainM, run.gainM);
  assert.ok(Math.abs(again.gainM - 20) < 0.5);
  assert.equal(again.climbs.length, 0);
  const back = clearManualClimbPatch({ ...edited, ...again });
  assert.equal(back.gainM, run.gainM);
  assert.equal(back.manualClimb, null);
  assert.deepEqual(back.efforts, run.efforts);
  assert.equal(clearManualClimbPatch(run), null);
});

test('metres per split, limits and validation', () => {
  const { run, stream } = treadmill([{ sec: 1800, pace: 360, hr: 140 }]);
  const s = kmSplits(run, stream);
  assert.deepEqual(splitGains(s, [50, '30', '', 'x', -5], 'm'), [50, 30, 0, 0, 0]);
  assert.deepEqual(splitGains(s, [99, 0, 0, 0, 0], 'pct').map(Math.round), [250, 0, 0, 0, 0]); // capped at 25 %
  assert.equal(validateSplitValues(['', 3, 0], 'pct'), null);
  assert.match(validateSplitValues([30], 'pct'), /above 25%/);
  assert.match(validateSplitValues([-1], 'm'), /zero or more/);
  assert.match(validateSplitValues([500], 'm'), /more than 400 m/);
  const patch = manualClimbPatch(run, null, [40, 40, 40, 40, 40], 'm'); // no stream, e.g. after a restore
  assert.ok(Math.abs(patch.gainM - 200) < 0.01);
  assert.equal(patch.efforts.w20.bestPace, null); // every window climbs 40 m per km
});

// a treadmill interval session written the way Coros exports it: no position, no altitude, one <Lap> per step
function lapTcx(steps) {
  let t = Date.parse('2026-11-10T12:14:15Z');
  let d = 0;
  const laps = steps.map(({ sec, pace, hr }) => {
    const start = new Date(t).toISOString();
    const startD = d;
    const tps = [];
    for (let k = 0; k < sec; k++) {
      // the wrist sensor updates distance in steps: every 4th second shows no change
      if (k % 4 !== 3) d += (1000 / pace) * (4 / 3);
      tps.push(`<Trackpoint><Time>${new Date(t).toISOString()}</Time><DistanceMeters>${d.toFixed(1)}</DistanceMeters><HeartRateBpm><Value>${hr}</Value></HeartRateBpm></Trackpoint>`);
      t += 1000;
    }
    return `<Lap StartTime="${start}"><TotalTimeSeconds>${sec}</TotalTimeSeconds><DistanceMeters>${(d - startD).toFixed(1)}</DistanceMeters><Track>${tps.join('')}</Track></Lap>`;
  });
  return `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Id>2026-11-10T12:14:15Z</Id>${laps.join('')}</Activity></Activities></TrainingCenterDatabase>`;
}

test('treadmill intervals: laps become rows, timer time is kept, and the pace is not used for thresholds', async () => {
  const { parseActivityFile } = await import('../js/core/tcx.js');
  const { lapSplits, defaultBasis, splitsFor } = await import('../js/core/splits.js');
  const steps = [{ sec: 600, pace: 400, hr: 125 }];
  for (let i = 0; i < 6; i++) steps.push({ sec: 120, pace: 390, hr: 150 }, { sec: 90, pace: 405, hr: 140 });
  steps.push({ sec: 160, pace: 420, hr: 138 });
  const [act] = parseActivityFile(lapTcx(steps), 'tm.tcx');
  assert.equal(act.laps.length, 14);
  const r = analyzeActivity(act, { tzOffsetMin: 420 });
  assert.ok(r.ok);
  const run = { id: 7, ...r.run };
  assert.equal(run.indoor, true);
  // seconds with no distance change are sensor steps indoors, not stops
  assert.ok(Math.abs(run.movingSec - steps.reduce((s, x) => s + x.sec, 0)) <= 2, `moving ${run.movingSec}`);
  assert.equal(defaultBasis(run), 'laps');
  const rows = lapSplits(run, r.stream);
  assert.equal(rows.length, 14);
  assert.equal(rows[1].lapSec, 120);
  assert.ok(Math.abs(rows[1].avgHr - 150) < 2 && Math.abs(rows[2].avgHr - 140) < 2);
  assert.ok(Math.abs(rows.reduce((s, x) => s + x.distM, 0) - run.distanceKm * 1000) < 0.5);
  const values = [0, 6, 1, 7, 1, 7, 1, 7, 1, 8, 1, 8, 1, 0];
  const patch = manualClimbPatch(run, r.stream, values, 'pct', 'laps');
  const expected = rows.reduce((s, x, i) => s + (x.distM * values[i]) / 100, 0);
  assert.ok(Math.abs(patch.gainM - expected) < 0.01);
  assert.equal(patch.manualClimb.basis, 'laps');
  assert.equal(patch.climbs.length, 0); // 2-minute climbs are shorter than a sustained climb
  // indoor pace is never a threshold-pace estimate
  assert.equal(collectEfforts([{ ...run, ...patch }], 500).pace.length, 0);
  // a run without laps falls back to 1 km splits
  assert.equal(splitsFor({ ...run, laps: null }, r.stream, 'laps').length, Math.round(run.distanceKm));
});

test('outdoor runs keep moving time without standing still, and laps shorter than 20 m are merged', async () => {
  const pts = makePoints([{ sec: 600, pace: 360, hr: 140 }, { sec: 60, pace: 99999, hr: 120 }, { sec: 600, pace: 360, hr: 140 }]);
  const act = { sport: 'Running', startTime: pts[0].t, points: pts, laps: [{ startMs: 0, sec: 600, distM: 1667 }, { startMs: 0, sec: 2, distM: 5 }, { startMs: 0, sec: 658, distM: 1667 }] };
  const r = analyzeActivity(act, { tzOffsetMin: 420 });
  assert.equal(r.run.indoor, false);
  assert.ok(r.run.movingSec <= 1205, `standing still counted: ${r.run.movingSec}`);
  assert.equal(r.run.laps.length, 2);
});

test('switching rows keeps the total climbing', async () => {
  const { convertValues } = await import('../js/core/splits.js');
  const { run, stream } = treadmill([{ sec: 1800, pace: 360, hr: 140 }]);
  const km = kmSplits(run, stream);
  const halves = [{ startM: 0, distM: 2500 }, { startM: 2500, distM: run.distanceKm * 1000 - 2500 }];
  const v = convertValues(halves, [8, 0], 'pct', km);
  assert.deepEqual(v.slice(0, 3), [8, 8, 4]);
  const total = (rows, vals) => splitGains(rows, vals, 'pct').reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total(km, v) - 200) < 0.5);
  assert.deepEqual(convertValues(km, ['', '', '', '', ''], 'm', halves), ['', '']);
});
