// Formatting and parsing for paces (seconds per km) and durations (seconds).

/** 330 -> "5:30". Returns "–" for missing values. */
export function formatPace(sec) {
  if (sec == null || !Number.isFinite(sec)) return '–';
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "5:30" -> 330. Returns null when the text is not a pace. */
export function parsePace(text) {
  if (typeof text !== 'string') return null;
  const m = /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 15300 -> "4:15:00". */
export function formatDuration(sec) {
  if (sec == null || !Number.isFinite(sec)) return '';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * "4:15:00" -> 15300; "4:15" is read as hours and minutes -> 15300.
 * Returns null when the text is not a duration.
 */
export function parseDuration(text) {
  if (typeof text !== 'string') return null;
  const parts = text.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d{1,2}$/.test(p))) return null;
  const nums = parts.map(Number);
  const [h, m, s = 0] = nums;
  if (m > 59 || s > 59) return null;
  return h * 3600 + m * 60 + s;
}
