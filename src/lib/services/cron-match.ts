// Minimal 5-field cron matcher ("m h dom mon dow") evaluated in an IANA timezone.
// Supports *, numbers, lists (1,15), ranges (1-5) and steps (*/15, 0-30/10). Day-of-week 0 and 7 are Sunday.

const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  return field.split(',').some(part => {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) return false;
    let lo: number, hi: number;
    if (rangePart === '*') { lo = min; hi = max; }
    else if (rangePart.includes('-')) { [lo, hi] = rangePart.split('-').map(Number); }
    else { lo = Number(rangePart); hi = stepPart ? max : lo; }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return false;
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}

// One formatter per timezone: building one per call made scanning ahead for the next run slow.
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false, minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function zonedParts(date: Date, timeZone = 'UTC') {
  const parts = formatterFor(timeZone).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return {
    minute: Number(get('minute')),
    hour: Number(get('hour')) % 24,
    day: Number(get('day')),
    month: Number(get('month')),
    weekday: WEEKDAYS[get('weekday').toLowerCase().slice(0, 3)] ?? date.getUTCDay(),
  };
}

export function cronMatches(expr: string, date: Date, timeZone = 'UTC'): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [m, h, dom, mon, dow] = fields;
  let t;
  try { t = zonedParts(date, timeZone); } catch { t = zonedParts(date, 'UTC'); }
  const dowMatches = fieldMatches(dow, t.weekday, 0, 7) || (t.weekday === 0 && fieldMatches(dow, 7, 0, 7));
  const domMatches = fieldMatches(dom, t.day, 1, 31);
  // Standard cron: when both day fields are restricted, either one matching is enough.
  const dayOk = dom !== '*' && dow !== '*' ? domMatches || dowMatches : domMatches && dowMatches;
  return fieldMatches(m, t.minute, 0, 59) && fieldMatches(h, t.hour, 0, 23) && fieldMatches(mon, t.month, 1, 12) && dayOk;
}

/** The next minute (after `from`) the schedule fires, looking up to 35 days ahead; null when not in that window. */
export function nextCronRun(expr: string, timeZone = 'UTC', from: Date = new Date()): Date | null {
  if (expr.trim().split(/\s+/).length !== 5) return null;
  const start = (Math.floor(from.getTime() / 60_000) + 1) * 60_000;
  for (let i = 0; i < 35 * 24 * 60; i++) {
    const at = new Date(start + i * 60_000);
    if (cronMatches(expr, at, timeZone)) return at;
  }
  return null;
}

/**
 * Makes a schedule's cron agree with the time in its human label. Command Center replied "every day
 * at 2:30 PM IST" but emitted cron "0 9 * * *" with timezone Asia/Kolkata — it converted to UTC and
 * then labelled the result IST, so the mission would have run at 9:00 AM. The label carries the
 * user's own words, so a fixed hour/minute that disagrees with it is replaced.
 */
export function alignCronToLabel(cron: string, label: string): string {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5 || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])) return cron;
  const m12 = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b/i.exec(label);
  const m24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(label);
  let hour: number | null = null;
  let minute = 0;
  if (m12) {
    hour = Number(m12[1]) % 12 + (m12[3].toLowerCase() === 'p' ? 12 : 0);
    minute = m12[2] ? Number(m12[2]) : 0;
  } else if (m24) {
    hour = Number(m24[1]);
    minute = Number(m24[2]);
  }
  if (hour === null || hour > 23 || minute > 59) return cron;
  if (Number(fields[0]) === minute && Number(fields[1]) === hour) return cron;
  return [String(minute), String(hour), ...fields.slice(2)].join(' ');
}

/** "Next run Sat, 1 Nov, 9:00 am IST" for a schedule; a plain note when it is further out than 35 days. */
export function describeNextRun(expr: string, timeZone = 'UTC', from: Date = new Date()): string {
  const next = nextCronRun(expr, timeZone, from);
  if (!next) return 'Runs on its own on the chosen schedule.';
  let when: string;
  try {
    when = next.toLocaleString('en-IN', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  } catch {
    when = next.toUTCString();
  }
  return `Next run ${when}. Each run’s card shows up in the mission chat.`;
}
