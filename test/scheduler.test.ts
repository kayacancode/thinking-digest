import { describe, it, expect } from 'vitest';
import { isDigestDue, isShiftsDay, localDate, weekRange } from '../src/scheduler';
import { DEFAULT_SETTINGS } from '../src/types';

// 2026-11-23 is a Monday. Dates are built in local time so the tests hold in any time zone.
const at = (day: number, hour: number, minute: number) => new Date(2026, 10, day, hour, minute);
const settings = { ...DEFAULT_SETTINGS, digestTime: '07:30', digestDays: [1, 2, 3, 4, 5] };
const due = (now: Date, lastRunDate: string | null = null, digestExists = false) =>
  isDigestDue({ now, settings, lastRunDate, digestExists });

describe('localDate', () => {
  it('uses local calendar parts and pads them', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('isDigestDue', () => {
  it('is due on a weekday at or after the configured time', () => {
    expect(due(at(23, 7, 30))).toBe(true);
    expect(due(at(23, 18, 0))).toBe(true);
  });

  it('is not due before the configured time', () => {
    expect(due(at(23, 7, 29))).toBe(false);
    expect(due(at(23, 6, 45))).toBe(false);
  });

  it('is not due on a weekend day outside digestDays', () => {
    expect(due(at(22, 9, 0))).toBe(false);
    expect(due(at(28, 9, 0))).toBe(false);
  });

  it('is not due when it already ran today, but is due if the last run was yesterday', () => {
    expect(due(at(24, 9, 0), '2026-11-24')).toBe(false);
    expect(due(at(24, 9, 0), '2026-11-23')).toBe(true);
  });

  it('is not due when today’s digest note already exists', () => {
    expect(due(at(24, 9, 0), null, true)).toBe(false);
  });

  it('respects custom days and times', () => {
    const custom = { ...settings, digestDays: [0], digestTime: '21:05' };
    expect(isDigestDue({ now: at(22, 21, 5), settings: custom, lastRunDate: null, digestExists: false })).toBe(true);
    expect(isDigestDue({ now: at(22, 21, 4), settings: custom, lastRunDate: null, digestExists: false })).toBe(false);
  });
});

describe('isShiftsDay', () => {
  it('matches the configured weekday only', () => {
    expect(isShiftsDay(at(27, 9, 0), settings)).toBe(true);
    expect(isShiftsDay(at(26, 9, 0), settings)).toBe(false);
  });
});

describe('weekRange', () => {
  it('on a Sunday returns the Monday before through that Sunday', () => {
    expect(weekRange(at(22, 12, 0))).toEqual({ from: '2026-11-16', to: '2026-11-22' });
  });

  it('on a Monday returns that Monday through the next Sunday', () => {
    expect(weekRange(at(23, 0, 0))).toEqual({ from: '2026-11-23', to: '2026-11-29' });
  });

  it('crosses month boundaries', () => {
    expect(weekRange(new Date(2026, 11, 2, 9, 0))).toEqual({ from: '2026-11-30', to: '2026-12-06' });
  });
});
