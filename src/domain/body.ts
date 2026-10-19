import type { ExpenditurePoint } from './expenditure';
import { dayIndex, fromIndex } from './trend';
import { MEASUREMENT_KEYS, type BodyEntry, type ClockStyle, type DayMeta, type LengthUnit, type LogEntry, type MeasurementKey } from './types';
import { pad } from './util';

export const CM_PER_IN = 2.54;
export const toCm = (v: number, unit: LengthUnit) => (unit === 'in' ? v * CM_PER_IN : v);
export const fromCm = (cm: number, unit: LengthUnit) => (unit === 'in' ? cm / CM_PER_IN : cm);

/** Clock time for display; inputs of type="time" keep using 24-hour "HH:MM". */
export function timeLabel(minute: number, clock: ClockStyle = '24h', short = false): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  if (clock === '24h') return `${pad(h)}:${pad(m)}`;
  const h12 = h % 12 || 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return short && m === 0 ? `${h12} ${ampm}` : `${h12}:${pad(m)} ${ampm}`;
}

/** Most recent value of every tape measurement, with the day it was taken. */
export function latestMeasurements(body: BodyEntry[]): Partial<Record<MeasurementKey, { cm: number; date: string }>> {
  const out: Partial<Record<MeasurementKey, { cm: number; date: string }>> = {};
  for (const b of [...body].sort((a, c) => a.date.localeCompare(c.date))) {
    for (const k of MEASUREMENT_KEYS) {
      const v = b.measurements?.[k];
      if (v !== undefined && v > 0) out[k] = { cm: v, date: b.date };
    }
  }
  return out;
}

/** Days with a value for one measurement, oldest first. */
export function measurementSeries(body: BodyEntry[], key: MeasurementKey): { date: string; cm: number }[] {
  return body
    .filter((b) => (b.measurements?.[key] ?? 0) > 0)
    .map((b) => ({ date: b.date, cm: b.measurements![key]! }))
    .sort((a, c) => a.date.localeCompare(c.date));
}

/** Waist-to-height and waist-to-hip ratios from the latest tape measurements. */
export function bodyRatios(latest: ReturnType<typeof latestMeasurements>, heightCm: number): { waistToHeight?: number; waistToHip?: number } {
  const waist = latest.waist?.cm;
  const hips = latest.hips?.cm;
  return {
    waistToHeight: waist && heightCm > 0 ? waist / heightCm : undefined,
    waistToHip: waist && hips ? waist / hips : undefined,
  };
}

export interface HabitDay {
  date: string;
  food: boolean;
  weigh: boolean;
}

/** One cell per calendar day from `from` to `to`: did the user log food (or mark a fast) and weigh in. */
export function habitCalendar(log: LogEntry[], meta: DayMeta[], body: BodyEntry[], from: string, to: string): HabitDay[] {
  const food = new Set([...log.map((e) => e.date), ...meta.filter((m) => m.fasted).map((m) => m.date)]);
  const weigh = new Set(body.filter((b) => b.weight !== undefined).map((b) => b.date));
  const out: HabitDay[] = [];
  for (let d = dayIndex(from); d <= dayIndex(to); d++) {
    const date = fromIndex(d);
    out.push({ date, food: food.has(date), weigh: weigh.has(date) });
  }
  return out;
}

/**
 * Streaks for one habit over calendar days that end today: the current streak may skip today
 * (the day is not over yet), the best streak is the longest run, plus days done out of all days.
 */
export function habitStats(days: HabitDay[], key: 'food' | 'weigh'): { current: number; best: number; done: number; total: number } {
  let best = 0;
  let run = 0;
  for (const d of days) {
    run = d[key] ? run + 1 : 0;
    best = Math.max(best, run);
  }
  let i = days.length - 1;
  if (i >= 0 && !days[i][key]) i--;
  let current = 0;
  while (i >= 0 && days[i][key]) {
    current++;
    i--;
  }
  return { current, best, done: days.filter((d) => d[key]).length, total: days.length };
}

export interface EnergyBalance {
  /** Average logged intake on complete days. */
  intake: number;
  /** Average expenditure estimate on those days. */
  expenditure: number;
  /** intake − expenditure: negative is a deficit. */
  balance: number;
  days: number;
}

/**
 * Average daily energy balance over the `days` days before `today` (today is still in progress).
 * Partially logged days and days without food are skipped; days marked fasted count as 0 kcal.
 */
export function energyBalance(log: LogEntry[], meta: DayMeta[], expenditure: ExpenditurePoint[], today: string, days = 7): EnergyBalance | undefined {
  const kcal = new Map<string, number>();
  for (const e of log) kcal.set(e.date, (kcal.get(e.date) ?? 0) + (e.n.kcal ?? 0));
  const flags = new Map(meta.map((m) => [m.date, m]));
  const exp = new Map(expenditure.map((p) => [p.date, p.expenditure]));
  let intake = 0;
  let burn = 0;
  let n = 0;
  for (let d = dayIndex(today) - days; d < dayIndex(today); d++) {
    const date = fromIndex(d);
    const m = flags.get(date);
    if (m?.partial) continue;
    const eaten = kcal.get(date) ?? (m?.fasted ? 0 : undefined);
    const e = exp.get(date);
    if (eaten === undefined || e === undefined) continue;
    intake += eaten;
    burn += e;
    n++;
  }
  if (!n) return undefined;
  return { intake: intake / n, expenditure: burn / n, balance: (intake - burn) / n, days: n };
}

/** Consecutive period days grouped into date ranges, oldest first. */
export function periodRanges(body: BodyEntry[]): { from: string; to: string }[] {
  const days = body
    .filter((b) => b.period)
    .map((b) => dayIndex(b.date))
    .sort((a, c) => a - c);
  const out: { from: string; to: string }[] = [];
  for (const d of days) {
    const last = out.at(-1);
    if (last && dayIndex(last.to) >= d - 1) last.to = fromIndex(Math.max(d, dayIndex(last.to)));
    else out.push({ from: fromIndex(d), to: fromIndex(d) });
  }
  return out;
}

/**
 * Where today falls in the cycle: day 1 is the first day of the latest period. The average cycle
 * length uses gaps between period starts that look like whole cycles (15–60 days).
 */
export function cycleInfo(body: BodyEntry[], today: string): { day: number; start: string; avgLength?: number } | undefined {
  const starts = periodRanges(body)
    .map((r) => r.from)
    .filter((d) => d <= today);
  const start = starts.at(-1);
  if (!start) return undefined;
  const gaps = starts
    .slice(1)
    .map((d, i) => dayIndex(d) - dayIndex(starts[i]))
    .filter((g) => g >= 15 && g <= 60);
  return {
    day: dayIndex(today) - dayIndex(start) + 1,
    start,
    avgLength: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : undefined,
  };
}

/** Foods ranked for the History tab: most recent first, or most often logged. */
export function rankHistory(log: LogEntry[], sort: 'recent' | 'frequent'): string[] {
  const stats = new Map<string, { count: number; last: string }>();
  for (const e of log) {
    if (!e.foodId) continue;
    const key = `${e.date} ${String(e.minute).padStart(4, '0')}`;
    const s = stats.get(e.foodId) ?? { count: 0, last: '' };
    s.count++;
    if (key > s.last) s.last = key;
    stats.set(e.foodId, s);
  }
  return [...stats.entries()]
    .sort(([, a], [, b]) => (sort === 'frequent' ? b.count - a.count || b.last.localeCompare(a.last) : b.last.localeCompare(a.last)))
    .map(([id]) => id);
}
