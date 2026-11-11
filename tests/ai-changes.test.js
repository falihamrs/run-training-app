import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_TAG, applyPlanItems, changeFormatText, parseChangeBlock, previewChanges, settingsWith } from '../js/core/aiChanges.js';
import { aiReport } from '../js/core/aiExport.js';
import { addDays, nextMonday } from '../js/core/dates.js';
import { generatePlan } from '../js/core/plan/generate.js';
import { TERRAIN, hist, settingsFor } from './helpers/plan.js';

const settings = settingsFor({ mode: 'trail', distanceKm: 25, gain: 1200, runs: 4, weeks: 16, terrain: TERRAIN });
const plan = generatePlan(settings, hist(), { today: '2026-12-28' }).plan;
const today = addDays(plan.startDate, 15); // week 3, Tuesday
const wk = (n) => plan.weeks[n - 1];
const byRole = (n, role) => wk(n).workouts.find((w) => w.role === role);

const answer = (block, tag = BLOCK_TAG) => `Overall you are doing well. Here is my analysis...\n\n- Point one\n- Point two\n\n\`\`\`${tag}\n${block}\n\`\`\`\n\nGood luck!`;

test('the block is found in an answer, with lenient JSON, the last block winning', () => {
  const r = parseChangeBlock(answer('{ "changes": [ { "op": "rest", "workout": "w5-Tue", "reason": "tired", }, ] }'));
  assert.equal(r.found, true);
  assert.equal(r.changes.length, 1);
  // the AI quotes the example first, then gives its own block
  const two = `Example:\n\`\`\`${BLOCK_TAG}\n{"changes":[{"op":"rest","workout":"w1-Mon"}]}\n\`\`\`\nMine:\n\`\`\`${BLOCK_TAG}\n{"changes":[{"op":"rest","workout":"w9-Mon"}]}\n\`\`\``;
  assert.equal(parseChangeBlock(two).changes[0].workout, 'w9-Mon');
  // a json fence, curly quotes, or no fence at all
  assert.equal(parseChangeBlock(answer('{"changes":[{"op":"easy","workout":"w5-Tue"}]}', 'json')).changes.length, 1);
  assert.equal(parseChangeBlock('Changes: {“changes”: [{“op”: “rest”, “workout”: “w5-Tue”}]} done').found, true);
  const none = parseChangeBlock('No changes needed, keep going!');
  assert.equal(none.found, false);
  assert.match(none.error, /No `plan-changes` block/);
  const broken = parseChangeBlock(answer('{ "changes": [ { "op": "rest" '));
  assert.equal(broken.found, false);
  assert.match(broken.error, /not valid JSON/);
});

test('preview: workout changes are checked as AI changes, in order', () => {
  const q = byRole(6, 'Q1') ?? byRole(6, 'Q2');
  const long = byRole(6, 'L');
  const cur = wk(3).workouts.find((w) => w.role !== 'S' && w.date > today);
  const items = previewChanges(plan, settings, [
    { op: 'easy', workout: q.id, minutes: 40, reason: 'recover' },
    { op: 'duration', workout: long.id, minutes: long.plannedMin - 10 },
    { op: 'duration', workout: long.id, minutes: long.plannedMin + 90 },
    { op: 'rest', workout: cur.id },
    { op: 'rest', workout: 'race' },
    { op: 'fly', workout: q.id },
    { op: 'scale_week', week: 7, factor: 0.9 },
  ], { today });
  assert.deepEqual(items.map((i) => i.status), ['ok', 'ok', 'refused', 'refused', 'refused', 'refused', 'ok']);
  assert.equal(items[0].reason, 'recover');
  assert.match(items[0].text, /easy run 40 min/);
  assert.match(items[2].error, /long run would grow|more than the 10%/);
  assert.match(items[3].error, /next Monday/);
  assert.match(items[4].error, /race cannot/);
  assert.match(items[5].error, /Not understood/);
  // apply only what was ticked, as one undo step logged as AI with its reason
  const r = applyPlanItems(plan, [items[0], items[6]], { today });
  assert.ok(r.results.every((x) => x.ok));
  assert.equal(r.plan.undo.length, 1);
  assert.deepEqual(r.plan.edits.map((e) => [e.source, e.reason]), [['ai', 'recover'], ['ai', null]]);
  assert.equal(r.plan.weeks.flatMap((w) => w.workouts).find((w) => w.id === q.id).code, 'EZ');
});

test('settings and threshold suggestions', () => {
  const items = previewChanges(plan, settings, [
    { op: 'setting', field: 'runsPerWeek', value: 5 },
    { op: 'setting', field: 'terrain.Thu', value: 'hills' },
    { op: 'setting', field: 'unavailable.Mon', value: true },
    { op: 'setting', field: 'longRunDay', value: 'saturday' },
    { op: 'setting', field: 'race.date', value: '2027-01-01' },
    { op: 'setting', field: 'runsPerWeek', value: 9 },
    { op: 'threshold', lthr: 172, pace: '6:15/km', from: addDays(today, 12), reason: 'faster tempo' },
    { op: 'threshold', lthr: 300 },
  ], { today });
  assert.deepEqual(items.map((i) => i.status), ['ok', 'ok', 'ok', 'ok', 'refused', 'refused', 'suggestion', 'refused']);
  assert.match(items[0].text, /Runs per week 4 → 5/);
  assert.match(items[4].error, /not a setting the AI can change/);
  assert.deepEqual(items[6].threshold, { lthr: 172, paceSecPerKm: 375, effectiveFrom: addDays(today, 12), label: items[6].threshold.label });
  const next = settingsWith(settings, items.slice(0, 4));
  assert.equal(next.schedule.runsPerWeek, 5);
  assert.equal(next.schedule.dayTerrain.Thu, 'hills');
  assert.ok(next.schedule.unavailableDays.includes('Mon'));
  assert.equal(next.schedule.longRunDay, 'Sat');
  assert.equal(settings.schedule.runsPerWeek, 4); // the original is untouched
  // a past "from" date becomes next Monday
  assert.equal(previewChanges(plan, settings, [{ op: 'threshold', lthr: 170, from: '2020-01-01' }], { today })[0].threshold.effectiveFrom, nextMonday(today));
});

test('the report carries workout ids, the change log and the format, and a sample answer round-trips', () => {
  const edited = applyPlanItems(plan, previewChanges(plan, settings, [{ op: 'rest', workout: byRole(6, 'E').id, reason: 'travel' }], { today }), { today }).plan;
  const md = aiReport({ plan: edited, runs: [], settings, today, range: 'all' });
  assert.match(md, new RegExp(`\\[${byRole(6, 'L').id}\\]`));
  assert.match(md, /## Changes made to the plan[\s\S]*from AI feedback: .*removed \(rest day\) — reason: travel/);
  assert.match(md, /## If you suggest changes[\s\S]*```plan-changes/);
  assert.ok(md.includes(nextMonday(today)));
  // the example in the format parses and every example op is understood
  const example = changeFormatText(plan, today);
  const p = parseChangeBlock(example);
  assert.equal(p.found, true);
  assert.equal(p.changes.length, 7);
  const items = previewChanges(plan, settings, p.changes, { today });
  assert.ok(items.every((i) => i.kind !== 'unknown'));
});
