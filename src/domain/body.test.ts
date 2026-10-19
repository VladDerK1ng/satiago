import { describe, expect, it } from 'vitest';
import { bodyRatios, cycleInfo, energyBalance, fromCm, habitCalendar, habitStats, latestMeasurements, periodRanges, rankHistory, timeLabel, toCm } from './body';
import type { LogEntry } from './types';

const entry = (date: string, kcal: number, foodId?: string, minute = 600): LogEntry => ({ id: date + kcal + (foodId ?? ''), date, minute, name: 'x', icon: '', foodId, n: { kcal } });

describe('units and time', () => {
  it('round-trips inches', () => {
    expect(toCm(10, 'in')).toBeCloseTo(25.4);
    expect(fromCm(25.4, 'in')).toBeCloseTo(10);
    expect(fromCm(80, 'cm')).toBe(80);
  });
  it('formats 12- and 24-hour clocks', () => {
    expect(timeLabel(8 * 60 + 5)).toBe('08:05');
    expect(timeLabel(0, '12h')).toBe('12:00 AM');
    expect(timeLabel(13 * 60 + 30, '12h')).toBe('1:30 PM');
    expect(timeLabel(12 * 60, '12h', true)).toBe('12 PM');
  });
});

describe('measurements', () => {
  const body = [
    { date: '2026-10-01', measurements: { waist: 90, hips: 100 } },
    { date: '2026-10-08', measurements: { waist: 88 } },
  ];
  it('keeps the latest value per site', () => {
    const l = latestMeasurements(body);
    expect(l.waist).toEqual({ cm: 88, date: '2026-10-08' });
    expect(l.hips).toEqual({ cm: 100, date: '2026-10-01' });
  });
  it('computes ratios', () => {
    const r = bodyRatios(latestMeasurements(body), 176);
    expect(r.waistToHeight).toBeCloseTo(0.5);
    expect(r.waistToHip).toBeCloseTo(0.88);
    expect(bodyRatios({}, 176)).toEqual({ waistToHeight: undefined, waistToHip: undefined });
  });
});

describe('habits and balance', () => {
  it('marks food, fasts and weigh-ins per day', () => {
    const cal = habitCalendar([entry('2026-10-01', 500)], [{ date: '2026-10-02', fasted: true }], [{ date: '2026-10-03', weight: 80 }], '2026-10-01', '2026-10-03');
    expect(cal).toEqual([
      { date: '2026-10-01', food: true, weigh: false },
      { date: '2026-10-02', food: true, weigh: false },
      { date: '2026-10-03', food: false, weigh: true },
    ]);
  });
  it('averages complete days before today and skips partial ones', () => {
    const exp = ['2026-10-16', '2026-10-17', '2026-10-18'].map((date) => ({ date, expenditure: 2500, held: false, validDays: 7 }));
    const log = [entry('2026-10-16', 2000), entry('2026-10-17', 3000), entry('2026-10-18', 100), entry('2026-10-19', 9999)];
    const b = energyBalance(log, [{ date: '2026-10-18', partial: true }], exp, '2026-10-19', 7)!;
    expect(b.days).toBe(2);
    expect(b.intake).toBe(2500);
    expect(b.balance).toBe(0);
    expect(energyBalance([], [], exp, '2026-10-19')).toBeUndefined();
  });
  it('groups period days and tracks the cycle', () => {
    const p = (date: string) => ({ date, period: true });
    const body = [p('2026-09-01'), p('2026-09-02'), p('2026-09-03'), p('2026-09-29'), p('2026-09-30'), { date: '2026-10-05', weight: 70 }];
    expect(periodRanges(body)).toEqual([
      { from: '2026-09-01', to: '2026-09-03' },
      { from: '2026-09-29', to: '2026-09-30' },
    ]);
    expect(cycleInfo(body, '2026-10-05')).toEqual({ day: 7, start: '2026-09-29', avgLength: 28 });
    expect(cycleInfo([], '2026-10-05')).toBeUndefined();
  });
  it('ranks history by recency or frequency', () => {
    const log = [entry('2026-10-01', 1, 'oats'), entry('2026-10-02', 2, 'oats'), entry('2026-10-03', 3, 'egg'), entry('2026-10-03', 4)];
    expect(rankHistory(log, 'recent')).toEqual(['egg', 'oats']);
    expect(rankHistory(log, 'frequent')).toEqual(['oats', 'egg']);
  });
});

describe('habitStats', () => {
  const days = (pattern: string, start = '2026-10-01') =>
    [...pattern].map((c, i) => ({ date: new Date(Date.parse(start + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10), food: c === 'x', weigh: false }));
  it('counts the current streak, allowing today to be still open', () => {
    expect(habitStats(days('xx.xxx'), 'food')).toMatchObject({ current: 3, best: 3, done: 5, total: 6 });
    expect(habitStats(days('xxxxx.'), 'food')).toMatchObject({ current: 5, best: 5 });
    expect(habitStats(days('xxx..x'), 'food')).toMatchObject({ current: 1, best: 3 });
    expect(habitStats(days('......'), 'food')).toMatchObject({ current: 0, best: 0, done: 0 });
  });
});
