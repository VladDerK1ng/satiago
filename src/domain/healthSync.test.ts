import { describe, expect, it } from 'vitest';
import { importValue, normalizeBodyFat, planHealthExport, planHealthImport, sampleTime, syncStartDate, type ExportInput } from './healthSync';
import type { BodyEntry, LogEntry } from './types';

const entry = (date: string, kcal: number): LogEntry => ({ id: `${date}-${kcal}`, date, minute: 720, name: 'x', icon: '🍽️', n: { kcal } });

describe('importValue', () => {
  it('converts kg to the user unit with one decimal', () => {
    expect(importValue('weight', 80, 'kg')).toBe(80);
    expect(importValue('weight', 80, 'lb')).toBe(176.4);
  });
  it('treats body-fat fractions as percentages and rejects implausible values', () => {
    expect(normalizeBodyFat(0.185)).toBeCloseTo(18.5);
    expect(importValue('bodyFat', 0.185, 'kg')).toBe(18.5);
    expect(importValue('bodyFat', 22.04, 'kg')).toBe(22);
    expect(importValue('bodyFat', 90, 'kg')).toBeUndefined();
    expect(importValue('weight', 5, 'kg')).toBeUndefined();
    expect(importValue('steps', Number.NaN, 'kg')).toBeUndefined();
    expect(importValue('steps', 8123.6, 'kg')).toBe(8124);
  });
});

describe('planHealthImport', () => {
  const body: BodyEntry[] = [
    { date: '2026-10-10', weight: 81.2 },
    { date: '2026-10-11', bodyFat: 20 },
  ];

  it('never overwrites an existing value for the same date and field', () => {
    const plan = planHealthImport(body, { weight: [{ date: '2026-10-10', value: 79 }], bodyFat: [{ date: '2026-10-11', value: 25 }] }, 'kg');
    expect(plan.patches).toEqual([]);
    expect(plan.imported).toBe(0);
    expect(plan.skipped).toBe(2);
  });

  it('fills empty fields on dates that already have other fields', () => {
    const plan = planHealthImport(body, { weight: [{ date: '2026-10-11', value: 80.5 }], steps: [{ date: '2026-10-10', value: 9000 }] }, 'kg');
    expect(plan.patches).toEqual([
      { date: '2026-10-10', steps: 9000 },
      { date: '2026-10-11', weight: 80.5 },
    ]);
    expect(plan.imported).toBe(2);
  });

  it('patches hold only new fields so saving them keeps existing values', () => {
    const plan = planHealthImport(body, { steps: [{ date: '2026-10-10', value: 4000 }] }, 'kg');
    expect(Object.keys(plan.patches[0]).sort()).toEqual(['date', 'steps']);
  });

  it('converts imported weights to pounds', () => {
    const plan = planHealthImport([], { weight: [{ date: '2026-10-12', value: 90 }] }, 'lb');
    expect(plan.patches).toEqual([{ date: '2026-10-12', weight: 198.4 }]);
  });

  it('skips duplicate samples for one date and field, keeping the first', () => {
    const plan = planHealthImport(
      [],
      {
        weight: [
          { date: '2026-10-12', value: 80 },
          { date: '2026-10-12', value: 81 },
        ],
        bodyFat: [{ date: '2026-10-12', value: 18 }],
      },
      'kg',
    );
    expect(plan.patches).toEqual([{ date: '2026-10-12', weight: 80, bodyFat: 18 }]);
    expect(plan.imported).toBe(2);
    expect(plan.skipped).toBe(1);
  });

  it('skips malformed dates and implausible values', () => {
    const plan = planHealthImport([], { weight: [{ date: '12/10/2026', value: 80 }, { date: '2026-10-12', value: 2 }] }, 'kg');
    expect(plan.patches).toEqual([]);
    expect(plan.skipped).toBe(2);
  });
});

describe('syncStartDate', () => {
  const now = new Date(2026, 9, 19, 10, 0);
  it('reaches back 90 days without a previous sync', () => {
    expect(syncStartDate(undefined, now)).toBe('2026-07-21');
  });
  it('starts on the local date of the previous sync', () => {
    expect(syncStartDate(new Date(2026, 9, 15, 22, 30).toISOString(), now)).toBe('2026-10-15');
    expect(syncStartDate('2026-10-14', now)).toBe('2026-10-14');
  });
  it('falls back to the default window for unreadable values', () => {
    expect(syncStartDate('garbage', now, 7)).toBe('2026-10-12');
  });
});

describe('planHealthExport', () => {
  const base: ExportInput = {
    body: [
      { date: '2026-10-10', weight: 176.4, bodyFat: 20 },
      { date: '2026-10-15', weight: 175.8 },
      { date: '2026-10-16', weight: 175.2, steps: 9000 },
      { date: '2026-10-19', weight: 175 },
    ],
    log: [entry('2026-10-15', 600), entry('2026-10-15', 1400.4), entry('2026-10-18', 2100), entry('2026-10-19', 500), entry('2026-10-14', 1800)],
    meta: [
      { date: '2026-10-16', waterMl: 2250 },
      { date: '2026-10-18', waterMl: 0 },
      { date: '2026-10-19', waterMl: 500 },
    ],
    unit: 'lb',
    from: '2026-10-15',
    today: '2026-10-19',
    writeNutrition: true,
    existing: { weight: [{ date: '2026-10-16', value: 79.5 }], bodyFat: [] },
  };

  it('writes weigh-ins in kg inside the window, skipping dates Health Connect already has', () => {
    const w = planHealthExport({ ...base, writeNutrition: false });
    expect(w).toEqual([
      { type: 'weight', date: '2026-10-15', value: 79.74 },
      { type: 'weight', date: '2026-10-19', value: 79.38 },
    ]);
  });

  it('does not write a field that could not be read (duplicates unknown)', () => {
    const w = planHealthExport({ ...base, writeNutrition: false, existing: {} });
    expect(w).toEqual([]);
  });

  it('writes body fat when Health Connect has none for the date', () => {
    const w = planHealthExport({ ...base, from: '2026-10-01', writeNutrition: false });
    expect(w.filter((x) => x.type === 'bodyFat')).toEqual([{ type: 'bodyFat', date: '2026-10-10', value: 20 }]);
  });

  it('writes daily kcal and water (liters) only for finished days in the window', () => {
    const w = planHealthExport({ ...base, existing: {} });
    expect(w).toEqual([
      { type: 'dietaryEnergyConsumed', date: '2026-10-15', value: 2000 },
      { type: 'dietaryWater', date: '2026-10-16', value: 2.25 },
      { type: 'dietaryEnergyConsumed', date: '2026-10-18', value: 2100 },
    ]);
  });

  it('writes no nutrition when the option is off', () => {
    const w = planHealthExport({ ...base, existing: {}, writeNutrition: false });
    expect(w.some((x) => x.type === 'dietaryEnergyConsumed' || x.type === 'dietaryWater')).toBe(false);
  });

  it('does not write the same finished day twice across consecutive syncs', () => {
    const first = planHealthExport({ ...base, existing: {}, from: '2026-10-15', today: '2026-10-17' });
    const second = planHealthExport({ ...base, existing: {}, from: '2026-10-17', today: '2026-10-19' });
    const days = [...first, ...second].filter((x) => x.type === 'dietaryEnergyConsumed').map((x) => x.date);
    expect(new Set(days).size).toBe(days.length);
  });
});

describe('sampleTime', () => {
  it('stamps past days at local noon and today no later than now', () => {
    const now = new Date(2026, 9, 19, 7, 15);
    expect(sampleTime('2026-10-18', now)).toEqual(new Date(2026, 9, 18, 12, 0));
    expect(sampleTime('2026-10-19', now)).toEqual(now);
  });
});
