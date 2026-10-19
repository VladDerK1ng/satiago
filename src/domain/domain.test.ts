import { describe, expect, it } from 'vitest';
import { analyze, buildSnapshot, checkInDue, intakeDays, loggingStreak, nextCheckIn, targetFor } from './coach';
import { bmr, expenditureSeries, initialExpenditure, KCAL_PER_KG } from './expenditure';
import { dayTotals, foodFromEntry, recipeToFood, scale, scoreFood } from './nutrition';
import { coachedTargets, goalDailyDelta, isMinor, safeGoal } from './targets';
import { dailyTrend, fromIndex, dayIndex } from './trend';
import type { BodyEntry, Food, Goal, LogEntry, Profile } from './types';

const profile: Profile = { sex: 'male', birthYear: 1996, heightCm: 180, activity: 'moderate', athlete: false };
const goal: Goal = {
  id: 'g',
  type: 'lose',
  startDate: '2026-01-05',
  startWeight: 90,
  goalWeight: 80,
  ratePct: 0.5,
  style: 'coached',
  diet: 'balanced',
  protein: 'moderate',
  floor: 'standard',
  highDays: [],
  highShift: 0,
  checkInDay: 0,
};
const day = (i: number) => fromIndex(dayIndex('2026-01-01') + i);

describe('nutrition math', () => {
  const oats: Food = { id: 'oats', name: 'Oats, dry', icon: '🥣', category: 'Grains', per100: { kcal: 380, protein: 13, carbs: 67, fat: 7 }, servings: [{ label: '1/2 cup', grams: 40 }], source: 'builtin' };
  const milk: Food = { id: 'milk', name: 'Milk, 2%', icon: '🥛', category: 'Dairy', per100: { kcal: 50, protein: 3.3, carbs: 4.8, fat: 2 }, servings: [{ label: '1 cup', grams: 240 }], source: 'builtin', liquid: true };
  it('scales per-100 g values', () => {
    expect(scale(oats.per100, 40).kcal).toBeCloseTo(152);
  });
  it('builds recipes using cooked weight', () => {
    const lookup = (id: string) => [oats, milk].find((f) => f.id === id);
    const f = recipeToFood({ id: 'r', name: 'Porridge', icon: '🥣', ingredients: [{ foodId: 'oats', grams: 80 }, { foodId: 'milk', grams: 300 }], servings: 2, createdAt: 0 }, lookup);
    const total = 380 * 0.8 + 50 * 3;
    expect(scale(f.per100, 380).kcal).toBeCloseTo(total);
    expect(f.servings[0].grams).toBe(190);
  });
  it('sums day totals', () => {
    const e = (kcal: number): LogEntry => ({ id: String(kcal), date: '2026-01-01', minute: 0, name: 'x', icon: '', n: { kcal, protein: 1 } });
    expect(dayTotals([e(100), e(250)])).toEqual({ kcal: 350, protein: 2 });
  });
  it('ranks food search', () => {
    expect(scoreFood({ name: 'Chicken breast', category: 'Meat' }, 'chicken')).toBeGreaterThan(scoreFood({ name: 'Chicken breast, fried, with skin', category: 'Meat' }, 'chicken'));
    expect(scoreFood({ name: 'Chicken thigh', category: 'Meat' }, 'chicken breast')).toBe(0);
    expect(scoreFood({ name: 'Chickpeas', category: 'Legumes', aliases: ['garbanzo'] }, 'garbanzo beans')).toBe(0);
    expect(scoreFood({ name: 'Chickpeas', category: 'Legumes', aliases: ['garbanzo beans'] }, 'garbanzo')).toBeGreaterThan(0);
  });
});

describe('trend', () => {
  it('smooths noise and follows a slope', () => {
    const body: BodyEntry[] = Array.from({ length: 60 }, (_, i) => ({ date: day(i), weight: 90 - i * 0.05 + (i % 2 ? 0.6 : -0.6) }));
    const t = dailyTrend(body, 0.1);
    expect(t).toHaveLength(60);
    const last = t[59].trend;
    expect(Math.abs(last - (90 - 59 * 0.05))).toBeLessThan(0.5);
    // Trend should be much smoother than the ±0.6 noise.
    const diffs = t.slice(1).map((p, i) => Math.abs(p.trend - t[i].trend));
    expect(Math.max(...diffs)).toBeLessThan(0.2);
  });
  it('dampens a single outlier', () => {
    const body: BodyEntry[] = Array.from({ length: 20 }, (_, i) => ({ date: day(i), weight: i === 10 ? 95 : 80 }));
    const t = dailyTrend(body, 0.1, undefined, false);
    expect(t[10].trend).toBeLessThan(80.5);
  });
  it('fills gaps day by day', () => {
    const t = dailyTrend([{ date: day(0), weight: 80 }, { date: day(5), weight: 81 }], 0.1);
    expect(t).toHaveLength(6);
  });
});

describe('expenditure', () => {
  it('uses Mifflin–St Jeor and Katch–McArdle', () => {
    expect(Math.round(bmr({ ...profile, birthYear: new Date().getFullYear() - 30 }, 80))).toBe(1780);
    expect(Math.round(bmr({ ...profile, bodyFat: 20 }, 80))).toBe(Math.round(370 + 21.6 * 64));
    expect(initialExpenditure(profile, 80)).toBeGreaterThan(2400);
  });

  // Simulate a person with a true TDEE of 2600 eating 2100: loses 500/7700 kg per day.
  const simulate = (days: number, eat: (i: number) => number | undefined, tdee = 2600) => {
    const body: BodyEntry[] = [];
    const intake = [];
    let w = 85;
    for (let i = 0; i < days; i++) {
      const kcal = eat(i);
      body.push({ date: day(i), weight: w + (i % 3 === 0 ? 0.4 : i % 3 === 1 ? -0.3 : 0) });
      intake.push({ date: day(i), kcal });
      w -= ((tdee - (kcal ?? 2100)) / KCAL_PER_KG);
    }
    return { body, intake };
  };

  it('converges toward the true expenditure', () => {
    const { body, intake } = simulate(70, () => 2100);
    const s = expenditureSeries(intake, dailyTrend(body, 0.1), 2200, day(69));
    expect(Math.abs(s.at(-1)!.expenditure - 2600)).toBeLessThan(150);
  });
  it('holds without recent weigh-ins', () => {
    const { body, intake } = simulate(40, () => 2100);
    const s = expenditureSeries(intake, dailyTrend(body.slice(0, 20), 0.1, day(39)), 2200, day(39));
    expect(s.at(-1)!.held).toBe(true);
    expect(s.at(-1)!.expenditure).toBe(s[s.length - 10].expenditure);
  });
  it('ignores partial days instead of reading them as low intake', () => {
    const { body, intake } = simulate(50, () => 2100);
    const withPartial = intake.map((d, i) => (i % 4 === 0 ? { ...d, kcal: 600, partial: true } : d));
    const a = expenditureSeries(intake, dailyTrend(body, 0.1), 2200, day(49)).at(-1)!.expenditure;
    const b = expenditureSeries(withPartial, dailyTrend(body, 0.1), 2200, day(49)).at(-1)!.expenditure;
    expect(Math.abs(a - b)).toBeLessThan(80);
  });
  it('uses expenditure imported from another app and continues smoothly from its last value', () => {
    const { body, intake } = simulate(60, () => 2100);
    // Another app estimated 2580 kcal for the first 40 days.
    const known = new Map(Array.from({ length: 40 }, (_, i) => [dayIndex(day(i)), 2580]));
    const s = expenditureSeries(intake, dailyTrend(body, 0.1), 2200, day(59), { known });
    expect(s[0]).toMatchObject({ expenditure: 2580, imported: true });
    expect(s[39]).toMatchObject({ expenditure: 2580, imported: true });
    expect(s[40].imported).toBeUndefined();
    // No jump after the hand-over: at most 50 kcal per day, ending near the true 2600.
    expect(Math.abs(s[40].expenditure - 2580)).toBeLessThanOrEqual(50);
    expect(Math.abs(s.at(-1)!.expenditure - 2600)).toBeLessThan(150);
  });
});

describe('targets', () => {
  it('applies the goal deficit', () => {
    expect(Math.round(goalDailyDelta(goal, 90))).toBe(-495);
    const r = coachedTargets(goal, 2700, 90, profile);
    expect(Math.abs(r.average - (2700 - 495))).toBeLessThan(15);
    expect(r.targets).toHaveLength(7);
    expect(r.targets[0].protein).toBe(Math.round(1.6 * Math.min(90, 27 * 1.8 ** 2)));
  });
  it('respects the calorie floor', () => {
    const r = coachedTargets({ ...goal, ratePct: 1 }, 1800, 70, { ...profile, sex: 'female', heightCm: 160 });
    expect(r.average).toBeGreaterThanOrEqual(1200);
    expect(r.flooredBy).toBeGreaterThan(0);
  });
  it('shifts calories to higher days while keeping the weekly total', () => {
    const flat = coachedTargets({ ...goal, type: 'maintain' }, 2500, 80, profile);
    const r = coachedTargets({ ...goal, type: 'maintain', highDays: [5, 6], highShift: 0.1 }, 2500, 80, profile);
    expect(r.targets[5].kcal).toBeGreaterThan(r.targets[0].kcal);
    expect(Math.abs(r.average - flat.average)).toBeLessThan(10);
  });
  it('keto keeps carbs low', () => {
    const r = coachedTargets({ ...goal, diet: 'keto' }, 2600, 85, profile);
    expect(r.targets[0].carbs).toBeLessThanOrEqual(30);
  });
});

describe('coach', () => {
  it('runs an end-to-end check-in and resolves targets', () => {
    const log: LogEntry[] = Array.from({ length: 21 }, (_, i) => ({ id: String(i), date: day(i), minute: 600, name: 'x', icon: '', n: { kcal: 2200 } }));
    const body: BodyEntry[] = Array.from({ length: 21 }, (_, i) => ({ date: day(i), weight: 88 - i * 0.05 }));
    const a = analyze({ log, meta: [], body, profile, unit: 'kg', trendAlpha: 0.1, today: day(20), fallbackWeight: 88 });
    expect(a.held).toBe(false);
    const snap = buildSnapshot(goal, a, profile, day(20));
    expect(targetFor(day(21), goal, [snap])?.kcal).toBeGreaterThan(1500);
    expect(targetFor(day(19), goal, [snap])).toBeUndefined();
    expect(checkInDue(goal, [snap], day(21))).toBe(false);
    expect(checkInDue(goal, [snap], day(27))).toBe(true);
  });
  it('treats fasted days as zero intake', () => {
    const days = intakeDays([], [{ date: day(0), fasted: true }]);
    expect(days[0].fasted).toBe(true);
  });
  it('computes streaks and next check-in', () => {
    const log = [day(0), day(1), day(2)].map((d) => ({ id: d, date: d, minute: 0, name: '', icon: '', n: {} }));
    expect(loggingStreak(log, [], day(2))).toBe(3);
    expect(loggingStreak(log, [], day(3))).toBe(3);
    expect(loggingStreak(log, [], day(5))).toBe(0);
    expect(nextCheckIn(goal, '2026-01-07')).toBe('2026-01-12');
  });
});

describe('foodFromEntry', () => {
  const base = { id: 'e1', date: '2026-10-18', minute: 480, name: 'Oats', icon: '🥣' };

  it('rebuilds per-100 values from a weighed entry so a new amount scales correctly', () => {
    const r = foodFromEntry({ ...base, grams: 80, qty: 80, servingLabel: 'g', n: { kcal: 300, protein: 10 } })!;
    expect(r.weighed).toBe(true);
    expect(r.food.servings).toEqual([]);
    expect(scale(r.food.per100, 120).kcal).toBeCloseTo(450);
    expect(scale(r.food.per100, 120).protein).toBeCloseTo(15);
  });

  it('keeps a named serving with its weight per unit', () => {
    const r = foodFromEntry({ ...base, grams: 480, qty: 2, servingLabel: '1 cup', n: { kcal: 400 } })!;
    expect(r.food.servings).toEqual([{ label: '1 cup', grams: 240 }]);
    expect(scale(r.food.per100, 240).kcal).toBeCloseTo(200);
  });

  it('works without a weight: servings are the only unit', () => {
    const r = foodFromEntry({ ...base, qty: 3, servingLabel: 'slice', n: { kcal: 270 } })!;
    expect(r.weighed).toBe(false);
    expect(scale(r.food.per100, r.food.servings[0].grams).kcal).toBeCloseTo(90);
  });

  it('reads the weight from a gram label when grams were not stored', () => {
    const r = foodFromEntry({ ...base, qty: 50, servingLabel: 'g', n: { kcal: 100 } })!;
    expect(r.weighed).toBe(true);
    expect(scale(r.food.per100, 100).kcal).toBeCloseTo(200);
  });

  it('trusts the quantity for weight units even when stored grams are wrong', () => {
    // Earlier imports stored MacroFactor's per-unit weight (1 g) instead of the amount (15 g).
    const r = foodFromEntry({ ...base, grams: 1, qty: 15, servingLabel: 'g', n: { kcal: 102 } })!;
    expect(scale(r.food.per100, 15).kcal).toBeCloseTo(102);
  });

  it('keeps millilitre entries liquid so the ml unit matches', () => {
    const r = foodFromEntry({ ...base, grams: 250, qty: 250, servingLabel: 'ml', n: { kcal: 110 } })!;
    expect(r.food.liquid).toBe(true);
  });

  it('leaves quick adds to the macro editor', () => {
    expect(foodFromEntry({ ...base, n: { kcal: 500 } })).toBeUndefined();
  });
});

describe('targetFor with several goals', () => {
  const t = (kcal: number) => Array.from({ length: 7 }, () => ({ kcal, protein: 150, carbs: 200, fat: 60 }));
  it("uses the given goal's snapshot even when another goal has a newer one", () => {
    const old = { date: '2026-10-19', goalId: 'old', expenditure: 2500, targets: t(2288), reason: '' };
    const cur = { date: '2026-10-18', goalId: goal.id, expenditure: 2300, targets: t(1958), reason: '' };
    expect(targetFor('2026-10-19', goal, [old, cur])?.kcal).toBe(1958);
  });
  it("falls back to any earlier snapshot for days before the goal's first one", () => {
    const old = { date: '2026-09-01', goalId: 'old', expenditure: 2500, targets: t(2400), reason: '' };
    const cur = { date: '2026-10-18', goalId: goal.id, expenditure: 2300, targets: t(1958), reason: '' };
    expect(targetFor('2026-09-10', goal, [old, cur])?.kcal).toBe(2400);
  });
});

describe('i18n plurals', () => {
  it('uses the singular form only for a count of one', async () => {
    const { t } = await import('../i18n');
    expect(t('data.ext.bodyFat', { count: 1 })).toBe('1 body fat reading');
    expect(t('data.ext.bodyFat', { count: 2 })).toBe('2 body fat readings');
    expect(t('log.summaryHint', { count: 1, other: 'consumed' })).toBe('1 food · tap to show consumed');
  });
});

describe('scoreFood text matching', () => {
  const f = (name: string) => ({ name, category: 'Prepared' });
  it('ignores accents in names and queries', () => {
    expect(scoreFood(f('Ovăz Proteic'), 'ovaz')).toBeGreaterThan(0);
    expect(scoreFood(f('Cartofi Cu Pui Și Cascaval'), 'si cascaval')).toBeGreaterThan(0);
    expect(scoreFood(f('Creme brulee'), 'crème')).toBeGreaterThan(0);
  });
  it('matches names in non-Latin scripts', () => {
    expect(scoreFood(f('Гречка'), 'греч')).toBeGreaterThan(0);
    expect(scoreFood(f('Гречка'), 'рис')).toBe(0);
  });
  it('does not match unrelated foods', () => {
    expect(scoreFood(f('Peanut Cream Crunch'), 'ovaz')).toBe(0);
  });
});

describe('safety limits', () => {
  const thisYear = new Date().getFullYear();
  const adult: Profile = { sex: 'female', birthYear: thisYear - 30, heightCm: 165, activity: 'light', athlete: false };
  const teen: Profile = { ...adult, birthYear: thisYear - 16 };
  const aggressive: Goal = { ...goal, ratePct: 1.25, floor: 'none' };

  it('never goes below the low floor, even when an old goal says "none"', () => {
    const r = coachedTargets(aggressive, 1400, 70, adult);
    expect(Math.min(...r.targets.map((x) => x.kcal))).toBeGreaterThanOrEqual(1000);
  });
  it('protects people under 18: standard floor and at most 0.5% loss per week', () => {
    expect(safeGoal(aggressive, teen)).toMatchObject({ floor: 'standard', ratePct: 0.5 });
    expect(safeGoal(aggressive, adult)).toMatchObject({ floor: 'low', ratePct: 1.25 });
    expect(isMinor(teen)).toBe(true);
    expect(isMinor(adult)).toBe(false);
  });
});
