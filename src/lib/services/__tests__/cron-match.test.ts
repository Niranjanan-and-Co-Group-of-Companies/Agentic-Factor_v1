import { describe, it, expect } from 'vitest';
import { alignCronToLabel, cronMatches } from '../cron-match';

// 2026-10-09 is a Friday. 03:30 UTC = 09:00 IST.
const at = (iso: string) => new Date(iso);

describe('cronMatches', () => {
  it('daily 9 AM in Asia/Kolkata fires at 03:30 UTC', () => {
    expect(cronMatches('0 9 * * *', at('2026-10-09T03:30:00Z'), 'Asia/Kolkata')).toBe(true);
    expect(cronMatches('0 9 * * *', at('2026-10-09T09:00:00Z'), 'Asia/Kolkata')).toBe(false);
  });

  it('weekday-only schedules respect the local day', () => {
    expect(cronMatches('0 9 * * 1-5', at('2026-10-09T03:30:00Z'), 'Asia/Kolkata')).toBe(true); // Friday
    expect(cronMatches('0 9 * * 1-5', at('2026-10-10T03:30:00Z'), 'Asia/Kolkata')).toBe(false); // Saturday
  });

  it('Monday 9 AM IST', () => {
    expect(cronMatches('0 9 * * 1', at('2026-10-12T03:30:00Z'), 'Asia/Kolkata')).toBe(true);
    expect(cronMatches('0 9 * * MON'.replace('MON', '1'), at('2026-10-13T03:30:00Z'), 'Asia/Kolkata')).toBe(false);
  });

  it('steps, lists and ranges', () => {
    expect(cronMatches('*/15 * * * *', at('2026-10-09T10:45:00Z'))).toBe(true);
    expect(cronMatches('*/15 * * * *', at('2026-10-09T10:44:00Z'))).toBe(false);
    expect(cronMatches('0 9,18 * * *', at('2026-10-09T18:00:00Z'))).toBe(true);
    expect(cronMatches('0 9-17/4 * * *', at('2026-10-09T13:00:00Z'))).toBe(true);
    expect(cronMatches('0 9-17/4 * * *', at('2026-10-09T12:00:00Z'))).toBe(false);
  });

  it('day 7 means Sunday', () => {
    expect(cronMatches('0 10 * * 7', at('2026-10-11T10:00:00Z'))).toBe(true);
  });

  it('day-of-month and day-of-week restricted together match either (standard cron)', () => {
    expect(cronMatches('0 0 1 * 1', at('2026-10-12T00:00:00Z'))).toBe(true); // a Monday, not the 1st
    expect(cronMatches('0 0 1 * 1', at('2026-10-01T00:00:00Z'))).toBe(true); // the 1st, a Thursday
  });

  it('rejects malformed expressions and falls back to UTC on a bad timezone', () => {
    expect(cronMatches('0 9 * *', at('2026-10-09T09:00:00Z'))).toBe(false);
    expect(cronMatches('0 9 * * *', at('2026-10-09T09:00:00Z'), 'Not/AZone')).toBe(true);
  });
});

describe('alignCronToLabel', () => {
  it('fixes a cron that was converted to UTC while labelled in local time', () => {
    expect(alignCronToLabel('0 9 * * *', 'Daily at 2:30 PM IST')).toBe('30 14 * * *');
  });

  it('keeps a cron that already matches, and the day fields', () => {
    expect(alignCronToLabel('30 14 * * *', 'Daily at 2:30 PM IST')).toBe('30 14 * * *');
    expect(alignCronToLabel('0 3 * * 1-5', 'Weekdays at 9 AM IST')).toBe('0 9 * * 1-5');
    expect(alignCronToLabel('0 9 * * 1', 'Every Monday at 9am')).toBe('0 9 * * 1');
  });

  it('handles 24-hour labels, 12 AM/PM and leaves unparseable cases alone', () => {
    expect(alignCronToLabel('0 0 * * *', 'Daily at 18:45')).toBe('45 18 * * *');
    expect(alignCronToLabel('0 5 * * *', 'Daily at 12 AM')).toBe('0 0 * * *');
    expect(alignCronToLabel('0 5 * * *', 'Daily at 12 PM')).toBe('0 12 * * *');
    expect(alignCronToLabel('*/15 * * * *', 'Every 15 minutes')).toBe('*/15 * * * *');
    expect(alignCronToLabel('0 9 * * *', 'Daily')).toBe('0 9 * * *');
  });
});
