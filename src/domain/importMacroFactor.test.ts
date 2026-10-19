import { describe, expect, it } from 'vitest';
import { importMacroFactor, isMacroFactorWorkbook } from './importMacroFactor';
import type { SheetRows } from './importMf';

/** Sheets laid out like MacroFactor's Excel export (headers copied from a real export, values invented). */
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const workbook: SheetRows[] = [
  {
    name: 'Calories & Macros',
    rows: [
      ['Date', 'Calories (kcal)', 'Fat (g)', 'Carbs (g)', 'Protein (g)'],
      [utc(2026, 1, 18), 2000, 70, 220, 130],
      [utc(2026, 1, 19), 0, 0, 0, 0],
      [utc(2026, 1, 20), 1800, 60, 200, 120],
    ],
  },
  {
    name: 'Micronutrients',
    rows: [
      ['Date', 'B12, Cobalamin (mcg)', 'Fiber (g)', 'Sodium (mg)', 'Sugars Added (g)', 'Omega-3 (g)'],
      [utc(2026, 1, 18), 2.4, 30, 2100, 12, 1.1],
      [utc(2026, 1, 20), 1.2, 25, 1900, 8, 0.4],
    ],
  },
  { name: 'Scale Weight', rows: [['Date', 'Weight (kg)', 'Fat Percent'], [utc(2026, 1, 18), 80.2, 18], [utc(2026, 1, 20), 79.8, null]] },
  {
    name: 'Body Metrics',
    rows: [
      ['Date', 'Bust (cm)', 'Hips (cm)', 'Left Bicep (cm)', 'Visual Body Fat Assessment', 'Waist (cm)'],
      [utc(2026, 1, 20), null, 100, 35, 17, 85],
    ],
  },
  { name: 'Weight Trend', rows: [['Date', 'Trend Weight (kg)'], [utc(2026, 1, 18), 80.1]] },
  { name: 'Steps', rows: [['Date', 'Steps'], [utc(2026, 1, 18), 8000], [utc(2026, 1, 19), 0]] },
  { name: 'Fasting', rows: [['Date', 'Fasting'], ['19/01/2026', 'Yes'], ['20/01/2026', 'No']] },
  { name: 'Partial Logging', rows: [['Date', 'Partial Logging'], ['20/01/2026', 'Yes']] },
  { name: 'Food Log Notes', rows: [['Date', 'Exercise Name', 'Food Log Notes'], [utc(2026, 1, 18), null, 'Birthday dinner']] },
  {
    name: 'Recipes',
    rows: [
      ['Recipe Name', 'Total Weight (g)', 'Serving Qty', 'Ingredients', 'Calories (kcal)', 'Protein (g)'],
      ['Overnight oats', null, 2, 'oats (1 cup)\nmilk (1 cup)', 600, 30],
      ['Chili', 1500, 5, 'beans', 1500, 100],
    ],
  },
  {
    name: 'Custom Foods',
    rows: [
      ['Food Name', 'Serving Size', 'Serving Qty', 'Serving Weight (g)', 'Calories (kcal)', 'Protein (g)'],
      ['Overnight oats', 'serving', 1, 100, 300, 15],
      ['Empty food', null, null, null, null, null],
      ['Greek yogurt', 'serving', 1.5, 100, 90, 15],
    ],
  },
  { name: 'Favorites', rows: [['Food Name', 'Serving Size', 'Serving Qty', 'Serving Weight (g)', 'Calories (kcal)'], ['Cheese', 'g', 40, 1, 130]] },
  {
    name: 'User Profile',
    rows: [
      ['Name', 'Email', 'Sex', 'Birthday', 'Height (cm)', 'Basic Activity Level', 'Prediction Style'],
      ['Someone', null, 'Female', '1990-05-01', 168, 'Lightly Active', 'Goal Rate Only'],
    ],
  },
  {
    name: 'Nutrition Program Settings',
    rows: [
      ['Program Update Date', 'Program Weekday', 'Calories (kcal)', 'Fat (g)', 'Protein (g)', 'Carbs (g)', 'Expenditure (kcal)'],
      ...['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d) => ['18/01/2026', d, 2100, 70, 150, 215, 2500]),
    ],
  },
  {
    name: 'Weight Goals',
    rows: [
      ['Goal', 'Status', 'Start Date', 'End Date', 'Goal Weight (kg)', 'Goal Rate per Week (%)', 'Starting Scale Weight (kg)'],
      ['Weight Gain', 'Completed', '01/01/2025', '01/06/2025', 82, 0.25, 78],
      ['Weight Loss', 'In Progress', '15/01/2026', null, 75, 0.5, 80],
    ],
  },
  { name: 'Workouts', rows: [[null, 'Exercise'], ['20 Jan 2026', 'Squat']] },
];

describe('MacroFactor workbook import', () => {
  const r = importMacroFactor(workbook, 'kg');

  it('recognizes the export', () => {
    expect(isMacroFactorWorkbook(workbook)).toBe(true);
    expect(isMacroFactorWorkbook([{ name: 'Sheet1', rows: [] }])).toBe(false);
  });

  it('merges macros and micronutrients into one total per logged day', () => {
    expect(r.log.map((e) => e.date)).toEqual(['2026-01-18', '2026-01-20']);
    expect(r.log[0]).toMatchObject({ id: 'macrofactor-total-2026-01-18', name: 'MacroFactor daily total' });
    expect(r.log[0].n).toMatchObject({ kcal: 2000, protein: 130, fiber: 30, sodium: 2100, vitaminB12: 2.4, addedSugar: 12 });
  });

  it('skips totals on days already logged in Satiago', () => {
    const s = importMacroFactor(workbook, 'kg', { skipTotalsOn: new Set(['2026-01-18']) });
    expect(s.log.map((e) => e.date)).toEqual(['2026-01-20']);
  });

  it('reads weight, body fat, measurements and steps', () => {
    const b18 = r.body.find((b) => b.date === '2026-01-18');
    const b20 = r.body.find((b) => b.date === '2026-01-20');
    expect(b18).toMatchObject({ weight: 80.2, bodyFat: 18, steps: 8000 });
    expect(b20).toMatchObject({ weight: 79.8, bodyFat: 17, measurements: { hips: 100, leftBicep: 35, waist: 85 } });
    expect(importMacroFactor(workbook, 'lb').body[0].weight).toBeCloseTo(176.8, 1);
  });

  it('reads fasting, partial days and notes', () => {
    expect(r.meta).toEqual([
      { date: '2026-01-18', note: 'Birthday dinner' },
      { date: '2026-01-19', fasted: true },
      { date: '2026-01-20', partial: true },
    ]);
  });

  it('imports foods per 100 g and recipes once', () => {
    const names = r.foods.map((f) => f.name);
    expect(names.filter((n) => n === 'Overnight oats')).toHaveLength(1);
    expect(names).not.toContain('Empty food');
    const cheese = r.foods.find((f) => f.name === 'Cheese')!;
    expect(cheese.servings).toEqual([{ label: '40 g', grams: 40 }]);
    expect(cheese.per100.kcal).toBeCloseTo(325);
    expect(r.favorites).toEqual([cheese.id]);
    const yogurt = r.foods.find((f) => f.name === 'Greek yogurt')!;
    expect(yogurt.servings).toEqual([{ label: '1 serving', grams: 100 }]);
    expect(yogurt.per100.kcal).toBeCloseTo(60);
    const chili = r.foods.find((f) => f.name === 'Chili')!;
    expect(chili.servings[0].grams).toBe(300);
    expect(chili.per100.kcal).toBeCloseTo(100);
    const oats = r.foods.find((f) => f.name === 'Overnight oats')!;
    expect(oats.noWeight).toBe(true);
    expect(oats.per100.kcal).toBeCloseTo(300);
  });

  it('reads the profile and projection style', () => {
    expect(r.profile).toEqual({ sex: 'female', birthYear: 1990, heightCm: 168, activity: 'light' });
    expect(r.settings?.projection).toBe('goal');
  });

  it('turns goals and weekly targets into Satiago goals and snapshots', () => {
    expect(r.goals.map((g) => [g.type, g.startDate, g.endedAt, g.goalWeight, g.ratePct])).toEqual([
      ['gain', '2025-01-01', '2025-06-01', 82, 0.25],
      ['lose', '2026-01-15', undefined, 75, 0.5],
    ]);
    expect(r.activeGoalId).toBe('macrofactor-goal-2026-01-15');
    expect(r.snapshots).toHaveLength(1);
    expect(r.snapshots[0]).toMatchObject({ date: '2026-01-18', goalId: 'macrofactor-goal-2026-01-15', expenditure: 2500 });
    expect(r.snapshots[0].targets[0]).toEqual({ kcal: 2100, protein: 150, carbs: 215, fat: 70 });
    // 18 Jan 2026 is a Sunday: check-ins follow MacroFactor's update day.
    expect(r.goals[1].checkInDay).toBe(6);
  });

  it('lists workout and recomputed sheets as not imported', () => {
    expect(r.summary.ignored).toEqual(['Weight Trend', 'Workouts']);
    expect(r.summary).toMatchObject({ dailyTotals: 2, weights: 2, steps: 1, measurements: 1, recipes: 2, foods: 2, goals: 2, targets: 1 });
  });
});

describe('MacroFactor import edge cases (code review)', () => {
  const sheets = (extra: SheetRows[]): SheetRows[] => [
    { name: 'Calories & Macros', rows: [['Date', 'Calories (kcal)'], [utc(2026, 1, 18), 2000]] },
    { name: 'Scale Weight', rows: [['Date', 'Weight (kg)'], [utc(2026, 1, 18), 80]] },
    ...extra,
  ];

  it('reads every B vitamin in MacroFactor\'s "B#, Name" header style', () => {
    const r = importMacroFactor(
      sheets([{ name: 'Micronutrients', rows: [['Date', 'B1, Thiamine (mg)', 'B2, Riboflavin (mg)', 'B3, Niacin (mg)', 'B6, Pyridoxine (mg)', 'B12, Cobalamin (mcg)', 'Folate (mcg)'], [utc(2026, 1, 18), 1.1, 1.3, 15, 1.5, 2.4, 400]] }]),
      'kg',
    );
    expect(r.log[0].n).toMatchObject({ thiamin: 1.1, riboflavin: 1.3, niacin: 15, vitaminB6: 1.5, vitaminB12: 2.4, folate: 400 });
  });

  it('reads micronutrient goals whose names have no unit', () => {
    const r = importMacroFactor(
      sheets([{ name: 'Micronutrient Goals', rows: [['Date', 'B12, Cobalamin Goal Type', 'B12, Cobalamin Floor', 'B12, Cobalamin Target', 'Fiber Floor', 'Fiber Target', 'Fiber Ceiling'], [utc(2026, 1, 18), 'Default', 2, 2.4, 25, 38, 70]] }]),
      'kg',
    );
    expect(r.settings?.microGoals).toEqual({ vitaminB12: { floor: 2, target: 2.4 }, fiber: { floor: 25, target: 38, ceiling: 70 } });
  });

  it('treats TRUE boolean cells as yes', () => {
    const r = importMacroFactor(sheets([{ name: 'Fasting', rows: [['Date', 'Fasting'], [utc(2026, 1, 19), true]] }]), 'kg');
    expect(r.meta).toEqual([{ date: '2026-01-19', fasted: true }]);
  });

  it('gives every food a distinct id, including non-Latin names', () => {
    const r = importMacroFactor(
      sheets([
        {
          name: 'Custom Foods',
          rows: [
            ['Food Name', 'Serving Size', 'Serving Qty', 'Serving Weight (g)', 'Calories (kcal)'],
            ['Гречка', 'g', 100, 1, 340],
            ['蕎麦', 'g', 100, 1, 350],
            ['Гречка', 'g', 50, 1, 170],
          ],
        },
      ]),
      'kg',
    );
    expect(new Set(r.foods.map((f) => f.id)).size).toBe(3);
    expect(r.foods.every((f) => !f.id.endsWith('-food-'))).toBe(true);
  });

  it('fills a missing starting weight from the first weigh-in on or after the start, or skips the goal', () => {
    const goals = (start: string): SheetRows => ({
      name: 'Weight Goals',
      rows: [['Goal', 'Status', 'Start Date', 'End Date', 'Goal Weight (kg)', 'Goal Rate per Week (%)', 'Starting Scale Weight (kg)'], ['Weight Loss', 'In Progress', start, null, 75, 0.5, null]],
    });
    expect(importMacroFactor(sheets([goals('17/01/2026')]), 'kg').goals[0].startWeight).toBe(80);
    expect(importMacroFactor(sheets([goals('17/02/2026')]), 'kg').goals[0].startWeight).toBe(80);
    const none = importMacroFactor([{ name: 'Calories & Macros', rows: [['Date', 'Calories (kcal)'], [utc(2026, 1, 18), 2000]] }, { name: 'Scale Weight', rows: [['Date', 'Weight (kg)']] }, goals('17/01/2026')], 'kg');
    expect(none.goals).toEqual([]);
    expect(none.activeGoalId).toBeUndefined();
  });
});

describe('foods in both Custom Foods and Favorites', () => {
  it('imports them once and marks them favorite', () => {
    const row = ['Cheese', 'g', 40, 1, 130];
    const head = ['Food Name', 'Serving Size', 'Serving Qty', 'Serving Weight (g)', 'Calories (kcal)'];
    const r = importMacroFactor(
      [
        { name: 'Calories & Macros', rows: [['Date', 'Calories (kcal)'], [utc(2026, 1, 18), 2000]] },
        { name: 'Scale Weight', rows: [['Date', 'Weight (kg)']] },
        { name: 'Custom Foods', rows: [head, row] },
        { name: 'Favorites', rows: [head, row] },
      ],
      'kg',
    );
    expect(r.foods).toHaveLength(1);
    expect(r.favorites).toEqual([r.foods[0].id]);
  });
});
