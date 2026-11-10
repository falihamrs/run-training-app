// Dependency-free TCX/GPX parsing (regex based, so it runs in Node tests and the browser alike).
import { haversine } from './geo.js';

const num = (s) => {
  if (s == null) return null;
  const v = Number(String(s).trim());
  return Number.isFinite(v) ? v : null;
};

/** Text of the first <tag>…</tag> (namespace prefix optional) inside xml, or null. */
function tagText(xml, tag) {
  const m = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, 'i').exec(xml);
  return m ? m[1].trim() : null;
}

function blocks(xml, tag) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push({ attrs: m[0].slice(0, m[0].indexOf('>')), body: m[1] });
  return out;
}

function parseTime(s) {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? t : null;
}

/** @returns {{sport:string,startTime:number|null,points:object[]}[]} */
export function parseTcx(text) {
  if (!/<(?:[\w.-]+:)?TrainingCenterDatabase/i.test(text)) throw new Error('Not a TCX file');
  const acts = [];
  for (const a of blocks(text, 'Activity')) {
    const sportM = /Sport="([^"]*)"/i.exec(a.attrs);
    const sport = sportM ? sportM[1] : 'Other';
    const points = [];
    for (const tp of blocks(a.body, 'Trackpoint')) {
      const t = parseTime(tagText(tp.body, 'Time'));
      if (t == null) continue;
      const pos = tagText(tp.body, 'Position');
      const hrBlock = tagText(tp.body, 'HeartRateBpm');
      points.push({
        t,
        lat: pos ? num(tagText(pos, 'LatitudeDegrees')) : null,
        lon: pos ? num(tagText(pos, 'LongitudeDegrees')) : null,
        alt: num(tagText(tp.body, 'AltitudeMeters')),
        dist: num(tagText(tp.body, 'DistanceMeters')),
        hr: hrBlock ? num(tagText(hrBlock, 'Value')) : null,
      });
    }
    points.sort((x, y) => x.t - y.t);
    const id = parseTime(tagText(a.body, 'Id'));
    // the watch's laps (auto laps or workout steps): start time, timer seconds and distance
    const laps = blocks(a.body, 'Lap').map((l) => ({
      startMs: parseTime(/StartTime="([^"]*)"/i.exec(l.attrs)?.[1]),
      sec: num(tagText(l.body.replace(/<(?:[\w.-]+:)?Track[\s>][\s\S]*$/i, ''), 'TotalTimeSeconds')),
      distM: num(tagText(l.body.replace(/<(?:[\w.-]+:)?Track[\s>][\s\S]*$/i, ''), 'DistanceMeters')),
    })).filter((l) => l.sec != null && l.distM != null);
    acts.push({ sport, startTime: points.length ? points[0].t : id, points, laps });
  }
  return acts;
}

export function parseGpx(text) {
  if (!/<gpx[\s>]/i.test(text)) throw new Error('Not a GPX file');
  const points = [];
  let prev = null;
  let cum = 0;
  for (const p of blocks(text, 'trkpt')) {
    const lat = num(/lat="([^"]*)"/i.exec(p.attrs)?.[1]);
    const lon = num(/lon="([^"]*)"/i.exec(p.attrs)?.[1]);
    const t = parseTime(tagText(p.body, 'time'));
    if (t == null || lat == null || lon == null) continue;
    if (prev) cum += haversine(prev.lat, prev.lon, lat, lon);
    const hr = num(tagText(p.body, 'hr'));
    points.push({ t, lat, lon, alt: num(tagText(p.body, 'ele')), dist: cum, hr });
    prev = { lat, lon };
  }
  points.sort((x, y) => x.t - y.t);
  const typeText = (tagText(text, 'type') || '').toLowerCase();
  let sport = 'Other';
  if (/run|trail/.test(typeText)) sport = 'Running';
  else if (/bik|cycl|ride/.test(typeText)) sport = 'Biking';
  else if (!typeText) sport = 'Unknown';
  return [{ sport, startTime: points.length ? points[0].t : null, points }];
}

/** Parse by content, not by extension. */
export function parseActivityFile(text, name = '') {
  const head = text.slice(0, 2000);
  if (/TrainingCenterDatabase/i.test(head)) return parseTcx(text);
  if (/<gpx[\s>]/i.test(head)) return parseGpx(text);
  throw new Error(`${name || 'File'} is not a TCX or GPX file`);
}
