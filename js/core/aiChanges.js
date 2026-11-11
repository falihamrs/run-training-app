// Reads plan changes an AI wrote in reply to the training report, checks each one, and applies the
// ones you accept. The AI is asked to end its answer with a ```plan-changes block of JSON; everything
// else in its answer is ignored.
import { WEEKDAYS, nextMonday } from './dates.js';
import { applyChange, applyChanges } from './edits.js';
import { parsePace, formatPace } from './units.js';

export const BLOCK_TAG = 'plan-changes';
const TERRAINS = ['flat', 'hills', 'incline'];
const OP_ALIASES = {
  move: 'move', duration: 'duration', length: 'duration', minutes: 'duration', easy: 'easy', makeeasy: 'easy',
  rest: 'rest', remove: 'rest', skip: 'rest', scaleweek: 'scaleWeek', scale: 'scaleWeek', setting: 'setting', settings: 'setting',
  threshold: 'threshold', thresholds: 'threshold',
};

/** The instructions and format printed at the end of the report. */
export function changeFormatText(plan, today) {
  const from = nextMonday(today);
  return [
    '## If you suggest changes',
    `If you recommend changes to the plan, end your answer with ONE fenced block tagged \`${BLOCK_TAG}\` containing JSON in this form. The app reads only that block; I will review every change before it is applied.`,
    '',
    '```' + BLOCK_TAG,
    '{',
    '  "changes": [',
    '    { "op": "duration", "workout": "w6-Sun", "minutes": 85, "reason": "why" },',
    '    { "op": "move", "workout": "w6-Fri", "to": "Sat", "reason": "why" },',
    '    { "op": "easy", "workout": "w7-Tue", "minutes": 40, "reason": "why" },',
    '    { "op": "rest", "workout": "w7-Thu", "reason": "why" },',
    '    { "op": "scaleWeek", "week": 8, "factor": 0.9, "reason": "why" },',
    '    { "op": "setting", "field": "runsPerWeek", "value": 5, "reason": "why" },',
    '    { "op": "threshold", "lthr": 172, "pace": "6:15", "from": "2026-12-01", "reason": "why" }',
    '  ]',
    '}',
    '```',
    '',
    'Rules the app enforces:',
    `- Workout changes apply from ${from} (next Monday) onwards; use the workout ids shown in [brackets] above.`,
    '- "move" stays within the same week (to: Mon…Sun). "duration": 15–360 minutes; quality sessions can only get shorter. "easy" turns a session into an easy run. "rest" removes it.',
    '- "scaleWeek": factor 0.7–1.1. A week may not go more than 10% over its target, the long run may not grow faster than the plan allows, and no hard session may sit next to another.',
    '- "setting" fields: runsPerWeek (3–7), longRunDay (Mon…Sun), terrain.Mon … terrain.Sun (flat, hills, incline), unavailable.Mon … unavailable.Sun (true/false). Setting changes rebuild the plan from next Monday, so workout ids after that may change: when you change settings, prefer week-level changes (scaleWeek) over single workouts.',
    '- "threshold" is shown to me as a suggestion only (lthr in bpm, pace as m:ss per km, from as a date).',
    '- The race, its date and past weeks cannot be changed.',
  ].join('\n');
}

// ---------- reading the block ----------

function looseJson(text) {
  const t = text
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(t);
}

// the first balanced {...} that contains "changes"
function bareObject(text) {
  let i = text.indexOf('"changes"');
  while (i >= 0) {
    let start = text.lastIndexOf('{', i);
    while (start >= 0) {
      let depth = 0, inStr = false;
      for (let k = start; k < text.length; k++) {
        const ch = text[k];
        if (inStr) { if (ch === '\\') k++; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
          const cand = text.slice(start, k + 1);
          try { const o = looseJson(cand); if (o && Array.isArray(o.changes)) return o; } catch { /* try a wider brace */ }
          break;
        }
      }
      start = text.lastIndexOf('{', start - 1);
    }
    i = text.indexOf('"changes"', i + 1);
  }
  return null;
}

/**
 * Finds the change block in an AI's answer (pasted text or an uploaded .md/.txt).
 * @returns {{found:boolean, changes:object[], error:string|null}}
 */
export function parseChangeBlock(text) {
  const src = String(text ?? '');
  const fences = [...src.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  const tagged = fences.filter((m) => m[1].toLowerCase() === BLOCK_TAG);
  const candidates = [...tagged, ...fences.filter((m) => !tagged.includes(m) && /"changes"/.test(m[2]))];
  let lastError = null;
  for (const m of candidates.reverse()) { // the last block wins, as the answer may quote the example first
    try {
      const o = looseJson(m[2]);
      const list = Array.isArray(o) ? o : o?.changes;
      if (Array.isArray(list)) return { found: true, changes: list, error: null };
      lastError = 'The block has no "changes" list.';
    } catch (err) {
      lastError = `The ${m[1] || 'code'} block is not valid JSON (${err.message}).`;
    }
  }
  const bare = bareObject(src.replace(/[\u201c\u201d]/g, '"'));
  if (bare) return { found: true, changes: bare.changes, error: null };
  return { found: false, changes: [], error: lastError ?? `No \`${BLOCK_TAG}\` block was found. Ask the AI to end its answer with the block described at the end of the report.` };
}

// ---------- checking ----------

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return { op: null };
  const op = OP_ALIASES[String(raw.op ?? raw.type ?? '').replace(/[\s_-]/g, '').toLowerCase()] ?? null;
  const c = { ...raw, op };
  if (c.workout == null && c.id != null) c.workout = c.id;
  if (c.workout != null) c.workout = String(c.workout).trim();
  if (op === 'move' && c.to == null && c.day != null) c.to = c.day;
  if (op === 'duration' && c.minutes == null && c.min != null) c.minutes = c.min;
  if (c.reason != null) c.reason = String(c.reason).slice(0, 500);
  return c;
}

const DAY = (v) => WEEKDAYS.find((d) => d.toLowerCase() === String(v ?? '').slice(0, 3).toLowerCase()) ?? null;

/** A setting change as { path, value, label } on the saved settings, or { error }. */
export function settingChange(settings, c) {
  const field = String(c.field ?? '').trim();
  const s = settings.schedule;
  let m;
  if (field === 'runsPerWeek') {
    const v = Number(c.value);
    if (!Number.isInteger(v) || v < 3 || v > 7) return { error: 'runsPerWeek must be a whole number from 3 to 7.' };
    return { path: 'schedule.runsPerWeek', value: v, label: `Runs per week ${s.runsPerWeek} → ${v}` };
  }
  if (field === 'longRunDay') {
    const d = DAY(c.value);
    if (!d) return { error: 'longRunDay must be a weekday, Mon to Sun.' };
    return { path: 'schedule.longRunDay', value: d, label: `Long run day ${s.longRunDay} → ${d}` };
  }
  if ((m = /^terrain\.(\w+)$/.exec(field))) {
    const d = DAY(m[1]);
    const v = String(c.value ?? '').toLowerCase();
    if (!d || !TERRAINS.includes(v)) return { error: 'terrain.<Day> must be flat, hills or incline.' };
    return { path: `schedule.dayTerrain.${d}`, value: v, label: `${d} terrain ${s.dayTerrain?.[d] ?? 'flat'} → ${v}` };
  }
  if ((m = /^unavailable\.(\w+)$/.exec(field))) {
    const d = DAY(m[1]);
    if (!d || typeof c.value !== 'boolean') return { error: 'unavailable.<Day> must be true or false.' };
    return { path: `schedule.unavailableDays.${d}`, value: c.value, label: `${d} ${c.value ? 'unavailable' : 'available'} for running` };
  }
  return { error: `"${field}" is not a setting the AI can change.` };
}

function thresholdChange(settings, c, today) {
  const lthr = c.lthr == null ? null : Number(c.lthr);
  const pace = c.pace == null ? (c.paceSecPerKm == null ? null : Number(c.paceSecPerKm)) : typeof c.pace === 'number' ? c.pace : parsePace(String(c.pace).replace(/\s*(min)?\s*\/?\s*km\s*$/i, ''));
  if (lthr == null && pace == null) return { error: 'A threshold suggestion needs lthr, pace or both.' };
  if (lthr != null && (!Number.isFinite(lthr) || lthr < 100 || lthr > 220)) return { error: 'lthr must be between 100 and 220 bpm.' };
  if (pace != null && (!Number.isFinite(pace) || pace < 150 || pace > 900)) return { error: 'pace must be between 2:30 and 15:00 per km.' };
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(c.from ?? '')) && c.from >= today ? c.from : nextMonday(today);
  const cur = [...(settings.thresholds ?? [])].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1)).at(-1);
  const parts = [lthr != null ? `LTHR ${cur?.lthr ?? '–'} → ${Math.round(lthr)} bpm` : null, pace != null ? `threshold pace ${cur?.paceSecPerKm ? formatPace(cur.paceSecPerKm) : '–'} → ${formatPace(pace)}/km` : null].filter(Boolean);
  return { lthr: lthr != null ? Math.round(lthr) : null, paceSecPerKm: pace != null ? Math.round(pace) : null, effectiveFrom: from, label: `${parts.join(', ')} from ${from}` };
}

/**
 * Checks every change. Plan changes are tried in order on a copy, as an AI change, so each item says
 * whether it would apply. Setting changes and threshold suggestions are checked on their own.
 * @returns {{kind:'plan'|'setting'|'threshold'|'unknown', status:'ok'|'refused'|'suggestion', change:object, text:string, reason:string|null, error:string|null, setting?:object, threshold?:object}[]}
 */
export function previewChanges(plan, settings, rawChanges, { today, runs = [] }) {
  let trial = plan;
  return rawChanges.map((raw) => {
    const c = normalize(raw);
    const reason = c.reason ?? null;
    if (!c.op) return { kind: 'unknown', status: 'refused', change: raw, text: JSON.stringify(raw).slice(0, 160), reason, error: 'Not understood: unknown "op".' };
    if (c.op === 'setting') {
      const sc = settingChange(settings, c);
      return sc.error ? { kind: 'setting', status: 'refused', change: c, text: `Setting ${c.field ?? '?'}`, reason, error: sc.error } : { kind: 'setting', status: 'ok', change: c, text: sc.label, reason, error: null, setting: sc };
    }
    if (c.op === 'threshold') {
      const t = thresholdChange(settings, c, today);
      return t.error ? { kind: 'threshold', status: 'refused', change: c, text: 'Threshold', reason, error: t.error } : { kind: 'threshold', status: 'suggestion', change: c, text: t.label, reason, error: null, threshold: t };
    }
    if (!plan) return { kind: 'plan', status: 'refused', change: c, text: describe(null, c), reason, error: 'There is no plan yet.' };
    const r = applyChange(trial, c, { today, runs, source: 'ai' });
    const text = r.ok ? r.summary : describe(trial, c);
    if (r.ok) trial = r.plan;
    return { kind: 'plan', status: r.ok ? 'ok' : 'refused', change: c, text, reason, error: r.ok ? null : r.error };
  });
}

function describe(plan, c) {
  const w = plan?.weeks.flatMap((x) => x.workouts).find((x) => x.id === c.workout);
  const what = w ? `${w.weekday} ${w.date} ${w.name}` : c.workout ? `workout ${c.workout}` : '';
  switch (c.op) {
    case 'move': return `${what} → ${c.to}`;
    case 'duration': return `${what} → ${c.minutes} min`;
    case 'easy': return `${what} → easy run${c.minutes ? ` ${c.minutes} min` : ''}`;
    case 'rest': return `${what} → rest day`;
    case 'scaleWeek': return `Week ${c.week} × ${c.factor}`;
    default: return JSON.stringify(c).slice(0, 120);
  }
}

/** Saved settings with the chosen setting changes applied. */
export function settingsWith(settings, items) {
  const s = JSON.parse(JSON.stringify(settings));
  for (const it of items) {
    const { path, value } = it.setting;
    if (path.startsWith('schedule.unavailableDays.')) {
      const d = path.split('.').pop();
      const set = new Set(s.schedule.unavailableDays ?? []);
      if (value) set.add(d); else set.delete(d);
      s.schedule.unavailableDays = WEEKDAYS.filter((x) => set.has(x));
    } else if (path.startsWith('schedule.dayTerrain.')) {
      s.schedule.dayTerrain = { ...(s.schedule.dayTerrain ?? {}), [path.split('.').pop()]: value };
    } else {
      s.schedule[path.split('.')[1]] = value;
    }
  }
  return s;
}

/** Applies the chosen plan changes as AI changes, one undo step. */
export function applyPlanItems(plan, items, { today, runs = [], label = 'AI feedback' }) {
  return applyChanges(plan, items.map((it) => it.change), { today, runs, source: 'ai', label });
}
