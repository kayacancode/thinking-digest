import type { Settings } from './types';

export function localDate(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function isDigestDue(a: {
  now: Date;
  settings: Settings;
  lastRunDate: string | null;
  digestExists: boolean;
}): boolean {
  const { now, settings } = a;
  if (!settings.digestDays.includes(now.getDay())) return false;
  if (now.getHours() * 60 + now.getMinutes() < minutesOf(settings.digestTime)) return false;
  return a.lastRunDate !== localDate(now) && !a.digestExists;
}

export function isShiftsDay(now: Date, settings: Settings): boolean {
  return now.getDay() === settings.shiftsDay;
}

export function weekRange(now: Date): { from: string; to: string } {
  const sinceMonday = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - sinceMonday);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { from: localDate(monday), to: localDate(sunday) };
}
