function parts(tz, ms = Date.now()) {
  const values = {};
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'long'
  });
  for (const p of format.formatToParts(new Date(ms))) values[p.type] = p.value;
  return {
    year: +values.year,
    month: +values.month,
    day: +values.day,
    hour: +values.hour,
    minute: +values.minute,
    weekday: values.weekday
  };
}

function offset(tz, ms) {
  const p = parts(tz, ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60000) * 60000;
}

function localToUtc(tz, year, month, day, hour = 0, minute = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  return guess - offset(tz, guess - offset(tz, guess));
}

function dayKey(tz, ms = Date.now()) {
  const p = parts(tz, ms);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function monthKey(tz, ms = Date.now(), shift = 0) {
  const p = parts(tz, ms);
  const d = new Date(Date.UTC(p.year, p.month - 1 + shift, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthRange(tz, month) {
  const [year, m] = month.split('-').map(Number);
  return [localToUtc(tz, year, m, 1), localToUtc(tz, year, m + 1, 1)];
}

function periodStart(period, tz) {
  if (period === 'week') return dayKey(tz, Date.now() - 6 * 86400000);
  if (period === 'month') return `${monthKey(tz)}-01`;
  return '0000-00-00';
}

function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parseStart(input, tz) {
  const text = (input || 'now').trim().toLowerCase();
  if (text === 'now') return Date.now();

  let m = text.match(/^(?:in\s*)?(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/);
  if (m && (m[1] || m[2])) return Date.now() + ((+m[1] || 0) * 60 + (+m[2] || 0)) * 60000;

  m = text.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = +m[1];
  const minute = +(m[2] || 0);
  if (m[3] === 'pm' && hour < 12) hour += 12;
  if (m[3] === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;

  const today = parts(tz);
  let start = localToUtc(tz, today.year, today.month, today.day, hour, minute);
  if (start < Date.now() - 5 * 60000) start = localToUtc(tz, today.year, today.month, today.day + 1, hour, minute);
  return start;
}

function formatMinutes(min) {
  const h = Math.floor(min / 60);
  return h ? `${h}h ${min % 60}m` : `${min}m`;
}

module.exports = { parts, localToUtc, dayKey, monthKey, monthRange, periodStart, validTimezone, parseStart, formatMinutes };
