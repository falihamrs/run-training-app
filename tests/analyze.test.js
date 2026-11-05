import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePoints, toTcx, toGpx } from './helpers/synth.js';
import { parseTcx, parseGpx, parseActivityFile } from '../js/core/tcx.js';
import { analyzeActivity } from '../js/core/analyze.js';
import { elevationProfile } from '../js/core/elevation.js';

const flat = (min, pace = 360, hr = 140) => [{ sec: min * 60, pace, hr }];
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('parses TCX, with and without namespace prefix', () => {
  const pts = makePoints(flat(10));
  for (const ns of ['', 'ns3']) {
    const acts = parseTcx(toTcx(pts, { ns }));
    assert.equal(acts.length, 1);
    assert.equal(acts[0].sport, 'Running');
    assert.equal(acts[0].points.length, pts.length);
    assert.equal(acts[0].points[5].hr, 140);
  }
  assert.throws(() => parseTcx('<foo/>'));
});

test('parses GPX with hr extension and computes distance', () => {
  const pts = makePoints(flat(10));
  const [a] = parseGpx(toGpx(pts));
  assert.equal(a.sport, 'Running');
  assert.equal(a.points[10].hr, 140);
  near(a.points.at(-1).dist, pts.at(-1).dist, pts.at(-1).dist * 0.02);
  assert.equal(parseActivityFile(toGpx(pts))[0].points.length, pts.length);
});

test('flat 10 km run: distance, pace, hr, terrain', () => {
  const pts = makePoints([{ sec: 3600, pace: 360, hr: 150 }]);
  const r = analyzeActivity(parseTcx(toTcx(pts))[0]);
  assert.ok(r.ok);
  near(r.run.distanceKm, 10, 0.1);
  near(r.run.avgPaceSecPerKm, 360, 3);
  near(r.run.avgHr, 150, 0.5);
  assert.equal(r.run.terrain, 'flat');
  near(r.run.efforts.w30.bestPace.paceSecPerKm, 360, 3);
});

test('pauses are excluded from moving time but kept in elapsed', () => {
  const pts = makePoints([...flat(10), { sec: 300, pause: true }, ...flat(10)]);
  const r = analyzeActivity(parseTcx(toTcx(pts))[0]);
  near(r.run.movingSec, 1200, 15);
  assert.ok(r.run.elapsedSec >= 1490);
});

test('slow walking segments (> 15:00/km) do not count as moving', () => {
  const pts = makePoints([...flat(10), { sec: 300, pace: 1200, hr: 100 }, ...flat(10)]);
  const r = analyzeActivity(parseTcx(toTcx(pts))[0]);
  near(r.run.movingSec, 1200, 15);
});

test('implausible heart rate values are dropped', () => {
  const pts = makePoints([{ sec: 600, pace: 360, hr: 150 }, { sec: 60, pace: 360, hr: 250 }, { sec: 600, pace: 360, hr: 150 }]);
  const r = analyzeActivity(parseTcx(toTcx(pts))[0]);
  assert.equal(r.run.maxHr, 150);
});

test('altitude jitter does not create gain; a real climb does', () => {
  const jitter = elevationProfile(makePoints(flat(20), { noise: 1.2 }).map((p) => p.alt));
  assert.ok(jitter.gain.at(-1) < 5, `gain ${jitter.gain.at(-1)}`);
  const pts = makePoints([{ sec: 600, pace: 360, hr: 140 }, { sec: 1200, pace: 600, hr: 160, grade: 0.1 }, { sec: 600, pace: 360, hr: 140 }]);
  const r = analyzeActivity(parseTcx(toTcx(pts))[0]);
  near(r.run.gainM, 200, 15);
  assert.equal(r.run.climbs.length, 1);
  near(r.run.climbs[0].gradePct, 10, 1.5);
  near(r.run.climbs[0].climbSpeedMh, 600, 60);
});

test('hardest 20-min window is found with its heart rate', () => {
  const pts = makePoints([...flat(15, 420, 130), { sec: 1200, pace: 330, hr: 168 }, ...flat(15, 420, 130)]);
  const r = analyzeActivity(parseTcx(toTcx(pts))[0]);
  near(r.run.efforts.w20.hard.avgHr, 168, 1);
  near(r.run.efforts.w20.hard.paceSecPerKm, 330, 4);
});

test('rejects tiny or empty activities', () => {
  assert.equal(analyzeActivity({ points: [] }).ok, false);
  const short = makePoints(flat(4));
  assert.equal(analyzeActivity(parseTcx(toTcx(short))[0]).ok, false);
});

test('local date follows the time zone offset', () => {
  const pts = makePoints(flat(10), { start: Date.parse('2026-03-02T20:00:00Z') });
  const act = parseTcx(toTcx(pts))[0];
  assert.equal(analyzeActivity(act, { tzOffsetMin: 0 }).run.date, '2026-03-02');
  assert.equal(analyzeActivity(act, { tzOffsetMin: 420 }).run.date, '2026-03-03');
});
