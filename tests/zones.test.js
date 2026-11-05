import test from 'node:test';
import assert from 'node:assert/strict';
import { formatHrRange, formatPaceRange, resolveZones, validateCorosZones, zoneIds } from '../js/core/zones.js';

const byId = (zones, id) => zones.find((z) => z.id === id);

test('road zones for threshold 5:30/km and LTHR 168', () => {
  const zones = resolveZones({ mode: 'road', lthr: 168, paceSecPerKm: 330 });
  assert.deepEqual(zones.map((z) => z.id), ['Z1', 'Z2', 'Z3', 'Z4', 'Z5a', 'Z5b', 'Z5c']);
  assert.equal(formatHrRange(byId(zones, 'Z1').hr), 'below 143 bpm');
  assert.equal(formatHrRange(byId(zones, 'Z2').hr), '143–150 bpm');
  assert.equal(formatHrRange(byId(zones, 'Z3').hr), '151–158 bpm');
  assert.equal(formatHrRange(byId(zones, 'Z4').hr), '160–166 bpm');
  assert.equal(formatHrRange(byId(zones, 'Z5a').hr), '168–171 bpm');
  assert.equal(formatHrRange(byId(zones, 'Z5b').hr), '173–178 bpm');
  assert.equal(formatHrRange(byId(zones, 'Z5c').hr), 'above 178 bpm');
  assert.equal(formatPaceRange(byId(zones, 'Z1').pace), 'slower than 7:06 /km');
  assert.equal(formatPaceRange(byId(zones, 'Z2').pace), '6:16–7:06 /km');
  assert.equal(formatPaceRange(byId(zones, 'Z3').pace), '5:50–6:13 /km');
  assert.equal(formatPaceRange(byId(zones, 'Z4').pace), '5:27–5:47 /km');
  assert.equal(formatPaceRange(byId(zones, 'Z5a').pace), '5:20–5:23 /km');
  assert.equal(formatPaceRange(byId(zones, 'Z5b').pace), '4:57–5:17 /km');
  assert.equal(formatPaceRange(byId(zones, 'Z5c').pace), 'faster than 4:57 /km');
});

test('a threshold update changes Z4 as in the spec example', () => {
  const z4 = byId(resolveZones({ mode: 'road', lthr: 170, paceSecPerKm: 322 }), 'Z4');
  assert.equal(formatPaceRange(z4.pace), '5:19–5:38 /km');
  assert.equal(formatHrRange(z4.hr), '162–168 bpm');
});

test('trail zones have five heart-rate zones with RPE and no pace on Z5', () => {
  const zones = resolveZones({ mode: 'trail', lthr: 168, paceSecPerKm: null });
  assert.deepEqual(zones.map((z) => z.id), ['Z1', 'Z2', 'Z3', 'Z4', 'Z5']);
  assert.deepEqual(zones.map((z) => z.rpe), ['1–2', '3–4', '5', '6–7', '8–10']);
  assert.equal(formatHrRange(byId(zones, 'Z5').hr), 'above 168 bpm');
  assert.equal(byId(zones, 'Z4').pace, null);
  const withPace = resolveZones({ mode: 'trail', lthr: 168, paceSecPerKm: 330 });
  assert.equal(byId(withPace, 'Z2').flatOnly, true);
  assert.equal(byId(withPace, 'Z5').pace, null);
});

test('missing thresholds give empty ranges, not errors', () => {
  const zones = resolveZones({ mode: 'road', lthr: null, paceSecPerKm: 330 });
  assert.equal(byId(zones, 'Z2').hr, null);
  assert.equal(formatHrRange(byId(zones, 'Z2').hr), '–');
  assert.equal(formatPaceRange(null), '–');
});

test('Coros zones override the percentage table when enabled', () => {
  const coros = {
    enabled: true,
    hr: { Z1: [null, 120], Z2: [121, 140], Z3: [141, 155], Z4: [156, 168], Z5: [169, null] },
    pace: { Z1: [420, null], Z2: [380, 420], Z3: [350, 380], Z4: [320, 350] },
  };
  const zones = resolveZones({ mode: 'road', lthr: 168, paceSecPerKm: 330, coros });
  const z2 = byId(zones, 'Z2');
  assert.equal(formatHrRange(z2.hr), '121–140 bpm');
  assert.equal(z2.hrSource, 'coros');
  assert.equal(formatPaceRange(z2.pace), '6:20–7:00 /km');
  // Z5 sub-zones all share the Coros Z5 heart-rate range; their pace stays percentage-based.
  assert.equal(formatHrRange(byId(zones, 'Z5b').hr), 'above 169 bpm');
  assert.equal(byId(zones, 'Z5b').paceSource, 'percent');
  const off = resolveZones({ mode: 'road', lthr: 168, paceSecPerKm: 330, coros: { ...coros, enabled: false } });
  assert.equal(byId(off, 'Z2').hrSource, 'percent');
});

test('Coros zone validation', () => {
  const good = {
    enabled: true,
    hr: { Z1: [null, 120], Z2: [121, 140], Z3: [141, 155], Z4: [156, 168], Z5: [169, null] },
    pace: {},
  };
  assert.deepEqual(validateCorosZones(good), []);
  assert.deepEqual(validateCorosZones({ enabled: false }), []);

  const overlap = { ...good, hr: { ...good.hr, Z3: [135, 155] } };
  assert.match(validateCorosZones(overlap)[0].message, /overlaps/);

  const missing = { ...good, hr: { Z1: [null, 120] } };
  assert.equal(validateCorosZones(missing).length, 4);

  const inverted = { ...good, hr: { ...good.hr, Z2: [140, 121] } };
  assert.match(validateCorosZones(inverted)[0].message, /below the upper bound/);

  const partialPace = { ...good, pace: { Z1: [420, null] } };
  assert.match(validateCorosZones(partialPace)[0].message, /completely/);

  const badPace = { ...good, pace: { Z1: [420, null], Z2: [380, 420], Z3: [350, 380], Z4: [350, 320] } };
  assert.match(validateCorosZones(badPace)[0].message, /quicker/);
});

test('zoneIds per mode', () => {
  assert.equal(zoneIds('road').length, 7);
  assert.equal(zoneIds('trail').length, 5);
});
