import { describe, expect, it } from 'vitest';
import { importSheets, mergeBody, parseCsv, parseDate, parseHeader, parseTime } from './importMf';

describe('spreadsheet import helpers', () => {
  it('splits headers into name and unit', () => {
    expect(parseHeader('Weight (kg)')).toEqual({ name: 'weight', unit: 'kg' });
    expect(parseHeader('Sodium [mg]')).toEqual({ name: 'sodium', unit: 'mg' });
    expect(parseHeader('Food Name')).toEqual({ name: 'food name' });
  });
  it('parses dates and times in common formats', () => {
    expect(parseDate('2026-03-07', false)).toBe('2026-03-07');
    expect(parseDate('3/7/2026', false)).toBe('2026-03-07');
    expect(parseDate('7/3/2026', true)).toBe('2026-03-07');
    expect(parseDate(46088, false)).toBe('2026-03-07'); // Excel serial
    expect(parseDate(new Date(2026, 2, 7), false)).toBe('2026-03-07');
    expect(parseTime('8:30 PM')).toBe(20 * 60 + 30);
    expect(parseTime('07:05')).toBe(425);
    expect(parseTime(0.5)).toBe(720);
  });
  it('parses CSV with quotes and semicolons', () => {
    expect(parseCsv('a,b\n"x, y",2\r\n"he said ""hi""",3')).toEqual([['a', 'b'], ['x, y', '2'], ['he said "hi"', '3']]);
    expect(parseCsv('Date;Weight (kg)\n2026-01-01;80,5')).toEqual([['Date', 'Weight (kg)'], ['2026-01-01', '80,5']]);
  });
});

describe('importSheets', () => {
  it('imports a detailed food log with units and micronutrients', () => {
    const r = importSheets(
      [
        {
          name: 'Food Log',
          rows: [
            ['Date', 'Time', 'Food Name', 'Serving Size', 'Serving Qty', 'Serving Weight (g)', 'Calories (kcal)', 'Protein (g)', 'Fat (g)', 'Carbs (g)', 'Sodium (mg)', 'Vitamin D (mcg)'],
            ['2026-03-07', '8:15 AM', 'Oats', '1/2 cup', 1, 40, 152, 5.2, 2.8, 27, 2, 0],
            // MacroFactor's Serving Weight is the weight of ONE unit: 1.5 x 100 g, and 15 x 1 g.
            ['2026-03-07', '1:00 PM', 'Chicken breast', '100 g', 1.5, 100, 248, 46.5, 5.4, 0, 111, 0.2],
            ['2026-03-07', '6:00 PM', 'Walnuts', 'g', 15, 1, 102, 2, 10, 2, 0, 0],
          ],
        },
      ],
      'kg',
    );
    expect(r.log).toHaveLength(3);
    expect(r.log[0]).toMatchObject({ date: '2026-03-07', minute: 495, name: 'Oats', qty: 1, grams: 40, servingLabel: '1/2 cup' });
    expect(r.log[1].n).toMatchObject({ kcal: 248, protein: 46.5, sodium: 111, vitaminD: 0.2 });
    expect(r.log[1]).toMatchObject({ qty: 1.5, grams: 150 });
    expect(r.log[2]).toMatchObject({ qty: 15, grams: 15, servingLabel: 'g' });
    expect(r.summary.foods).toBe(3);
  });

  it('imports a daily quick-export with weights in lbs and kJ energy', () => {
    const r = importSheets(
      [
        {
          name: 'Quick Export',
          rows: [
            ['Satiago test file'],
            [],
            ['Date', 'Expenditure', 'Trend Weight (lbs)', 'Weight (lbs)', 'Energy (kJ)', 'Protein (g)', 'Fat (g)', 'Carbs (g)', 'Steps'],
            ['03/14/2026', 2500, 180, 181.2, 8368, 150, 70, 200, 9001],
            ['03/15/2026', 2510, 179.8, '', 0, '', '', '', ''],
          ],
        },
      ],
      'kg',
      'MacroFactor',
    );
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toMatchObject({ date: '2026-03-14', name: 'MacroFactor daily total' });
    expect(r.log[0].n.kcal).toBeCloseTo(2000, 0);
    expect(r.body).toEqual([{ date: '2026-03-14', weight: 82.2, steps: 9001 }]);
    expect(r.summary.weights).toBe(1);
  });

  it('prefers itemized foods over daily totals for the same day and is idempotent by id', () => {
    const sheets = [
      { name: 'Totals', rows: [['Date', 'Calories'], ['2026-01-02', 2100], ['2026-01-03', 1900]] },
      { name: 'Foods', rows: [['Date', 'Food', 'Calories'], ['2026-01-02', 'Apple', 95]] },
    ];
    const a = importSheets(sheets, 'kg', 'MacroFactor');
    const b = importSheets(sheets, 'kg', 'MacroFactor');
    expect(a.log.map((e) => e.name).sort()).toEqual(['Apple', 'MacroFactor daily total']);
    expect(a.log.map((e) => e.id)).toEqual(b.log.map((e) => e.id));
  });

  it('warns when nothing matches', () => {
    expect(importSheets([{ name: 'x', rows: [['foo', 'bar']] }], 'kg').warnings).toHaveLength(1);
  });

  it('never overwrites existing body values', () => {
    const m = mergeBody([{ date: '2026-01-01', weight: 80 }], [{ date: '2026-01-01', weight: 70, steps: 5000 }, { date: '2026-01-02', weight: 79 }]);
    expect(m).toEqual([{ date: '2026-01-01', weight: 80, steps: 5000 }, { date: '2026-01-02', weight: 79 }]);
  });
});

describe('spreadsheet Date cells (code review)', () => {
  it('reads time-of-day from UTC-based spreadsheet times', () => {
    // read-excel-file returns a time-only cell as a UTC Date on 1899-12-30.
    expect(parseTime(new Date(Date.UTC(1899, 11, 30, 8, 30)))).toBe(510);
  });
});
