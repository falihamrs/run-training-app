// Seeded fuzzer over random settings: plan generation, edits and undo, regeneration, AI answers.
// Run: npm run fuzz            or  node tests/fuzz/fuzz.mjs [iterations=400] [seed=12345]
// Not part of npm test. Prints PASS or the first 40 problems, and exits 1 on any problem.
const imp = (p) => import(new URL(`../../${p}`, import.meta.url));
const { generatePlan } = await imp('js/core/plan/generate.js');
const W = await imp('js/core/plan/workouts.js');
const { applyChanges, undoLast, editsLostByRegen } = await imp('js/core/edits.js');
const { regenerateFrom } = await imp('js/core/tracking.js');
const { parseChangeBlock, previewChanges, changeFormatText, settingsWith } = await imp('js/core/aiChanges.js');
const { WEEKDAYS, addDays } = await imp('js/core/dates.js');
const { settingsFor, hist } = await imp('tests/helpers/plan.js');

const N = Number(process.argv[2] ?? 400);
let seed = Number(process.argv[3] ?? 12345);
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const fails = [];
const stats = { plans: 0, refused: 0, edits: 0, editOk: 0, swapOk: 0, swapAiOk: 0, aiOk: 0, regens: 0, parses: 0, previews: 0 };
const bad = (area, label, msg) => { if (fails.length < 40) fails.push(`[${area}] ${label}: ${msg}`); };
const nextMon = (d) => { let x = addDays(d, 1); while (new Date(x + 'T00:00Z').getUTCDay() !== 1) x = addDays(x, 1); return x; };

function randomCase(i) {
  const trail = rnd() < 0.55;
  const unavailable = WEEKDAYS.filter(() => rnd() < 0.15);
  const free = WEEKDAYS.filter((d) => !unavailable.includes(d));
  const terrain = Object.fromEntries(WEEKDAYS.map((d) => [d, trail ? pick(['flat', 'incline', 'hills']) : 'flat']));
  const longDay = pick(free.length ? free : ['Sun']);
  if (trail) terrain[longDay] = 'hills';
  const s = settingsFor({
    mode: trail ? 'trail' : 'road', distanceKm: trail ? pick([10, 15, 25, 42, 50, 80]) : pick([5, 10, 21.1, 42.195]),
    gain: trail ? pick([200, 800, 2300, 4000]) : 0, runs: int(2, 7), weeks: int(1, 60), terrain, unavailable,
    experience: pick(['new', 'intermediate', 'experienced']), lthr: pick([168, null]), pace: pick([330, 270, null]),
  });
  s.schedule.longRunDay = longDay;
  s.race.date = addDays(s.race.date, -int(0, 6));
  const h = hist({ baselineWeeklyKm: int(0, 90), baselineWeeklyHours: int(0, 10), baselineWeeklyVertM: int(0, 3000), longestRunKm: int(0, 35), longestRunMin: int(0, 240), returnFromBreak: rnd() < 0.1 });
  return { s, h, label: `#${i} ${s.race.mode} ${s.race.distanceKm}km/${s.race.elevationGainM}m ${s.schedule.runsPerWeek}x race ${s.race.date} unavail ${unavailable.join('/') || '-'}` };
}

function checkPlan(p, s, label, area) {
  const ids = new Set();
  const unavailable = s.schedule.unavailableDays;
  for (const w of p.weeks) {
    const runW = w.workouts.filter((x) => x.role !== 'S' && x.role !== 'RACE');
    const sum = runW.reduce((a, x) => a + x.plannedMin, 0);
    if (w.plannedMin !== sum) bad(area, label, `W${w.n} total ${w.plannedMin} != ${sum}`);
    for (const x of w.workouts) {
      if (ids.has(x.id)) bad(area, label, `duplicate id ${x.id}`);
      ids.add(x.id);
      if (x.date > p.raceDate) bad(area, label, `${x.id} after race`);
      if (x.role === 'RACE' || x.role === 'S') continue;
      if (!x.edited && unavailable.includes(x.weekday)) bad(area, label, `${x.id} on unavailable day`);
      if (W.totalMinutes(x.steps) !== x.plannedMin) bad(area, label, `${x.id} steps ${W.totalMinutes(x.steps)} != ${x.plannedMin}`);
      if (x.plannedMin < 15) bad(area, label, `${x.id} ${x.plannedMin} min`);
      if (x.plannedVertM > (400 * x.plannedMin) / 60 + 0.5) bad(area, label, `${x.id} ${x.plannedVertM} m in ${x.plannedMin} min`);
      if (x.plannedVertM && s.race.mode === 'trail' && !x.edited && !['hills', 'incline'].includes(s.schedule.dayTerrain[x.weekday]) && x.role !== 'L') bad(area, label, `${x.id} ${x.code}/${x.role} ${x.plannedVertM} m climbs on a flat day (${w.phase}, locked ${!!w.locked})`);
      if (!Number.isFinite(x.plannedMin)) bad(area, label, `${x.id} minutes ${x.plannedMin}`);
    }
  }
}

function randomChange(plan) {
  const all = plan.weeks.flatMap((w) => w.workouts).filter((x) => x.role !== 'RACE');
  const w = pick(all.length ? all : [{ id: 'w1-Mon' }]);
  switch (int(0, 8)) {
    case 0: return { op: 'move', workout: w.id, to: pick([...WEEKDAYS, 'xyz', '']) };
    case 1: return { op: 'duration', workout: w.id, minutes: pick([int(5, 400), '30', null, -1, 1e9]) };
    case 2: return { op: 'easy', workout: w.id, minutes: pick([undefined, int(10, 120)]) };
    case 3: return { op: 'rest', workout: w.id };
    case 4: return { op: 'scaleWeek', week: int(0, plan.weeks.length + 1), factor: pick([0.5, 0.7, 0.9, 1, 1.1, 1.3, 'x']) };
    case 5: return { op: pick(['delete', null, 'MOVE']), workout: w.id };
    case 6: { // a partner from the same week most of the time, so swaps actually apply
      const week = plan.weeks.find((x) => x.workouts.some((y) => y.id === w.id));
      return { op: 'swap', workout: w.id, with: pick(week && rnd() < 0.85 ? week.workouts : all).id };
    }
    case 7: return { op: 'swap', workout: w.id, with: pick([undefined, '', w.id, 'w999-Mon', pick(all).id]) };
    default: return { op: 'move', workout: 'w999-Mon', to: 'Tue' };
  }
}

for (let i = 0; i < N; i++) {
  const { s, h, label } = randomCase(i);
  const today = addDays(s.schedule.startDate, -int(0, 10));
  let r;
  try { r = generatePlan(s, h, { today, allowShort: rnd() < 0.5, overrideEntry: rnd() < 0.5 }); } catch (e) { bad('generate', label, `threw ${e.stack.split('\n').slice(0, 2).join(' ')}`); continue; }
  if (!r.plan) { stats.refused++; if (!r.messages?.length) bad('generate', label, 'refused with no message'); continue; }
  stats.plans++;
  let plan = r.plan;
  checkPlan(plan, s, label, 'generate');

  // ---- edits and undo, at a "today" somewhere inside the plan
  const inPlan = addDays(plan.weeks[0].start, int(0, Math.max(0, plan.weeks.length * 7 - 1)));
  for (let k = 0; k < 6; k++) {
    const source = rnd() < 0.5 ? 'ai' : 'manual';
    const changes = Array.from({ length: int(1, 3) }, () => randomChange(plan));
    let out;
    try { out = applyChanges(plan, changes, { today: inPlan, source }); } catch (e) { bad('edits', label, `threw on ${JSON.stringify(changes)}: ${e.message}`); break; }
    stats.edits += changes.length;
    for (const res of out.results) {
      if (!res.ok) { if (!res.error) bad('edits', label, `refused without text ${JSON.stringify(res.change)}`); continue; }
      stats.editOk++;
      if (res.change.op === 'swap') { stats.swapOk++; if (source === 'ai') stats.swapAiOk++; }
      if (source === 'ai') {
        stats.aiOk++;
        if (res.warnings.length) bad('edits', label, `AI change applied with warnings ${res.warnings}`);
        const id = res.change.workout;
        const w = out.plan.weeks.flatMap((x) => x.workouts).find((x) => x.id === id) ?? plan.weeks.flatMap((x) => x.workouts).find((x) => x.id === id);
        if (w && w.date < nextMon(inPlan) && res.change.op !== 'scaleWeek') bad('edits', label, `AI changed ${id} (${w.date}) before next Monday of ${inPlan}`);
        if (res.change.op === 'swap') {
          const all = out.plan.weeks.flatMap((x) => x.workouts);
          for (const x of all) if (x.edited && x.date < nextMon(inPlan) && !plan.weeks.flatMap((y) => y.workouts).find((y) => y.id === x.id)?.edited) bad('edits', label, `AI swap touched ${x.id} (${x.date}) before next Monday of ${inPlan}`);
        }
      }
    }
    if (out.plan !== plan) {
      checkPlan(out.plan, s, label, 'edits');
      const back = undoLast(out.plan);
      if (JSON.stringify(back.weeks) !== JSON.stringify(plan.weeks)) bad('edits', label, 'undo did not restore weeks');
      if (rnd() < 0.3) plan = back; else plan = out.plan;
    }
  }

  // ---- regenerate from inside the plan
  try {
    const lost = editsLostByRegen(plan, nextMon(inPlan));
    if (!(lost >= 0)) bad('regen', label, `editsLostByRegen ${lost}`);
    const g = regenerateFrom(plan, s, h, { today: inPlan });
    stats.regens++;
    if (g.plan) {
      const keepN = plan.weeks.filter((w) => w.start < nextMon(inPlan)).length;
      if (JSON.stringify(g.plan.weeks.slice(0, keepN).map((w) => w.workouts)) !== JSON.stringify(plan.weeks.slice(0, keepN).map((w) => w.workouts))) bad('regen', label, 'past weeks changed');
      g.plan.weeks.forEach((w, j) => { if (w.n !== j + 1) bad('regen', label, `week numbering ${w.n} at ${j + 1}`); });
      checkPlan(g.plan, s, label, 'regen');
      const u = undoLast(g.plan);
      if (JSON.stringify(u.weeks) !== JSON.stringify(plan.weeks)) bad('regen', label, 'undo of regen did not restore');
    }
  } catch (e) { bad('regen', label, `threw ${e.stack.split('\n').slice(0, 2).join(' ')}`); }

  // ---- AI answer parsing and preview
  try {
    const fmt = changeFormatText(plan, inPlan);
    const changes = Array.from({ length: int(0, 5) }, () => (rnd() < 0.7 ? randomChange(plan) : pick([
      { op: 'setting', field: pick(['runsPerWeek', 'longRunDay', 'raceDate', 'nope']), value: pick([4, 'Sat', '2027-06-26', -3, null]) },
      { op: 'threshold', lthr: pick([170, 20, null]), paceSecPerKm: pick([300, 'fast']) }, null, 7, 'text', [] ])));
    const body = JSON.stringify({ changes });
    const answers = [
      `Here you go\n\`\`\`plan-changes\n${body}\n\`\`\``,
      `${fmt}\n\nMy changes:\n\`\`\`json\n${body}\n\`\`\``,
      `\`\`\`plan-changes\n${body.slice(0, int(0, body.length))}\n\`\`\``,
      body.replace(/"/g, pick(['“', '"'])),
      String.fromCharCode(...Array.from({ length: 200 }, () => int(0, 0xffff))),
    ];
    for (const a of answers) {
      const p = parseChangeBlock(a);
      stats.parses++;
      if (!p.found && !p.error) bad('ai', label, 'not found and no error');
      if (p.found) {
        const pv = previewChanges(plan, s, p.changes, { today: inPlan });
        stats.previews++;
        if (pv.length !== p.changes.length) bad('ai', label, 'preview length');
        for (const it of pv) if (it.status === 'refused' && !it.error) bad('ai', label, `refused without text ${JSON.stringify(it.change)}`);
        const sw = settingsWith(s, pv.filter((x) => x.kind === 'setting' && x.status === 'ok'));
        if (!sw || !sw.schedule) bad('ai', label, 'settingsWith lost schedule');
      }
    }
  } catch (e) { bad('ai', label, `threw ${e.stack.split('\n').slice(0, 2).join(' ')}`); }
}
console.log(JSON.stringify(stats));
console.log(fails.length ? fails.join('\n') : 'PASS');
process.exit(fails.length ? 1 : 0);
