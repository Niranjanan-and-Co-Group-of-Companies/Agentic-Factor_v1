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

export function zonedParts(date: Date, timeZone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', weekday: 'short',
  }).formatToParts(date);
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
