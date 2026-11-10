// Section 6: place roles on calendar days so hard sessions never sit back to back.
import { WEEKDAYS } from '../dates.js';

const TEMPLATES = {
  3: ['Q1', 'E', 'L'],
  4: ['Q1', 'E', 'Q2', 'L'],
  5: ['E', 'Q1', 'E', 'Q2', 'L'],
  6: ['E', 'Q1', 'E', 'Q2', 'R', 'L'],
};
export function rolesFor(n) {
  if (n <= 3) return [...TEMPLATES[3]];
  if (n >= 7) return [...TEMPLATES[6], 'E'];
  return [...TEMPLATES[n]];
}

const idx = (d) => WEEKDAYS.indexOf(d);
const HARD = new Set(['L', 'Q1', 'Q2']);

function combos(arr, k) {
  const out = [];
  const rec = (start, cur) => {
    if (cur.length === k) { out.push([...cur]); return; }
    for (let i = start; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return out;
}

function nearest(days, target, prefer) {
  const cands = days.filter(prefer ?? (() => true));
  const pool = cands.length ? cands : days;
  return [...pool].sort((a, b) => Math.abs(idx(a) - idx(target)) - Math.abs(idx(b) - idx(target)) || idx(b) - idx(a))[0];
}

function costOf(assign, terrain, trail, anyClimb, avoidHard, avoidCost = 50) {
  let c = 0;
  // the day after another week's long run should not carry a quality session
  if (avoidHard && (assign[avoidHard] === 'Q1' || assign[avoidHard] === 'Q2')) c += avoidCost;
  const entries = Object.entries(assign).map(([d, r]) => [idx(d), r]);
  const hard = entries.filter(([, r]) => HARD.has(r)).map(([i]) => i);
  for (let a = 0; a < hard.length; a++) {
    for (let b = a + 1; b < hard.length; b++) {
      const gap = Math.abs(hard[a] - hard[b]);
      if (gap === 1 || gap === 6) c += 1000;
    }
  }
  const dayOf = (role) => entries.find(([, r]) => r === role)?.[0];
  const q1 = dayOf('Q1'), q2 = dayOf('Q2'), l = dayOf('L'), rr = dayOf('R');
  if (q1 != null) c += Math.abs(q1 - 1);
  if (q2 != null) c += Math.abs(q2 - 3);
  if (q1 != null && q2 != null && q2 < q1) c += 2;
  if (rr != null && l != null && rr !== (l + 1) % 7) c += 4;
  if (trail) {
    for (const [i, r] of entries) {
      const t = terrain[WEEKDAYS[i]];
      if (r === 'Q1') c += t === 'hills' ? 8 : t === 'incline' ? 4 : 0;
      if (r === 'Q2' && anyClimb) c += t === 'hills' ? 0 : t === 'incline' ? 1 : 12;
      if (r === 'E' && t === 'hills') c -= 2;
    }
  }
  return c;
}

function search({ days, n, roles, longDay, mediumDay, terrain, trail, anyClimb, avoidHard, avoidCost }) {
  const rest = [...roles];
  rest.splice(rest.indexOf('L'), 1);
  if (mediumDay) rest.splice(rest.indexOf('M'), 1);
  let best = null;
  const fixed = { [longDay]: 'L' };
  if (mediumDay) fixed[mediumDay] = 'M';
  for (const combo of combos(days, n)) {
    if (!combo.includes(longDay) || (mediumDay && !combo.includes(mediumDay))) continue;
    const free = combo.filter((d) => !(d in fixed));
    const seen = new Set();
    const permute = (left, cur) => {
      if (!left.length) {
        const key = cur.join(',');
        if (seen.has(key)) return;
        seen.add(key);
        const assign = { ...fixed };
        free.forEach((d, i) => { assign[d] = cur[i]; });
        const cost = costOf(assign, terrain, trail, anyClimb, avoidHard, avoidCost);
        if (!best || cost < best.cost) best = { cost, assign };
        return;
      }
      const tried = new Set();
      left.forEach((r, i) => {
        if (tried.has(r)) return;
        tried.add(r);
        permute([...left.slice(0, i), ...left.slice(i + 1)], [...cur, r]);
      });
    };
    permute(rest, []);
  }
  return best;
}

/**
 * @param opts { runs, available: weekday[], longDay, terrain: {Mon..Sun}, trail, b2b, raceWeek }
 * @returns {{assign:{[day]:role}, messages:string[], longDay:string}|null}
 */
export function placeRoles({ runs, available, longDay, terrain, trail, b2b = false, noLong = false, avoidHard = null, avoidCost = 50 }) {
  const messages = [];
  const days = WEEKDAYS.filter((d) => available.includes(d));
  const n = Math.min(runs, days.length);
  const anyClimb = days.some((d) => terrain[d] === 'hills' || terrain[d] === 'incline');

  let roles = rolesFor(n);
  if (noLong) {
    roles = roles.filter((r) => r !== 'L');
    roles.push('E');
  }
  let L = null;
  let M = null;
  if (!noLong) {
    L = days.includes(longDay) ? longDay : nearest(days, longDay);
    if (L !== longDay) messages.push(`The long-run day is not available, so the long run moves to ${L}.`);
    if (trail && terrain[L] !== 'hills' && days.some((d) => terrain[d] === 'hills')) {
      const alt = nearest(days, longDay, (d) => terrain[d] === 'hills');
      messages.push(`The long run moves from ${L} to ${alt} because it is the nearest hills day.`);
      L = alt;
    }
    if (b2b) {
      const cands = days.filter((d) => idx(d) < 6 && days.includes(WEEKDAYS[idx(d) + 1]));
      const good = cands.filter((d) => terrain[d] === 'hills' && terrain[WEEKDAYS[idx(d) + 1]] === 'hills');
      const pool = good.length ? good : cands.filter((d) => terrain[d] === 'hills');
      if (pool.length && n >= 4) {
        L = [...pool].sort((a, b) => Math.abs(idx(a) - idx(longDay)) - Math.abs(idx(b) - idx(longDay)))[0];
        M = WEEKDAYS[idx(L) + 1];
        const swap = roles.indexOf('E') >= 0 ? roles.indexOf('E') : roles.indexOf('R');
        if (swap >= 0) roles[swap] = 'M';
      } else b2b = false;
    }
  }
  const attempt = (rl) => {
    const rolesFinal = [...rl];
    const hasL = rolesFinal.includes('L');
    return search({ days, n, roles: rolesFinal, longDay: L ?? '__none__', mediumDay: M, terrain, trail, anyClimb, hasL, avoidHard, avoidCost });
  };
  let result;
  if (noLong) {
    result = searchNoLong({ days, n, roles, terrain, trail, anyClimb, avoidHard, avoidCost });
  } else {
    result = attempt(roles);
    if (result && result.cost >= 1000 && roles.includes('Q2')) {
      const demoted = roles.map((r) => (r === 'Q2' ? 'E' : r));
      const r2 = attempt(demoted);
      if (r2 && r2.cost < result.cost) {
        result = r2;
        messages.push('Quality session 2 became an easy run because it could not be spaced from the other hard sessions.');
      }
    }
  }
  if (!result) return null;
  return { assign: result.assign, messages, longDay: L, mediumDay: M, b2b: Boolean(M), runs: n };
}

function searchNoLong({ days, n, roles, terrain, trail, anyClimb, avoidHard, avoidCost }) {
  let best = null;
  for (const combo of combos(days, n)) {
    const seen = new Set();
    const permute = (left, cur) => {
      if (!left.length) {
        const key = cur.join(',');
        if (seen.has(key)) return;
        seen.add(key);
        const assign = {};
        combo.forEach((d, i) => { assign[d] = cur[i]; });
        const cost = costOf(assign, terrain, trail, anyClimb, avoidHard, avoidCost);
        if (!best || cost < best.cost) best = { cost, assign };
        return;
      }
      const tried = new Set();
      left.forEach((r, i) => {
        if (tried.has(r)) return;
        tried.add(r);
        permute([...left.slice(0, i), ...left.slice(i + 1)], [...cur, r]);
      });
    };
    permute([...roles], []);
  }
  return best;
}
