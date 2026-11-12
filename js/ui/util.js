export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Set a nested value; numeric path parts create arrays, others create objects. */
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** One display style for dates. 'long' 16 Nov 2026, 'short' 16 Nov, 'day' Mon 16 Nov. Stored and exported dates stay ISO. */
export function fmtDate(iso, style = 'long') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '')) return String(iso ?? '');
  const d = new Date(`${iso}T00:00:00Z`);
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  if (style === 'short') return base;
  if (style === 'day') return `${WEEKDAYS[d.getUTCDay()]} ${base}`;
  return `${base} ${d.getUTCFullYear()}`;
}

/** Local date and time of an ISO timestamp, e.g. 11 Nov 2026, 08:00. */
export function fmtDateTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${fmtDate(iso)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
