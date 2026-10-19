import { dayIndex, fromIndex, type TrendPoint } from './trend';
import type { ActivityLevel, Profile } from './types';

/** Energy stored per kg of body-mass change (mixed tissue). */
export const KCAL_PER_KG = 7700;
export const LB_PER_KG = 2.20462;

export const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.25,
  light: 1.4,
  moderate: 1.55,
  very: 1.75,
};

export function age(p: Profile, now = new Date()): number {
  return now.getFullYear() - p.birthYear;
}

/**
 * Resting energy: Katch–McArdle when body fat is known (lean-mass based),
 * otherwise Mifflin–St Jeor.
 */
export function bmr(p: Profile, weightKg: number, now = new Date()): number {
  if (p.bodyFat !== undefined && p.bodyFat > 3 && p.bodyFat < 70) {
    const lbm = weightKg * (1 - p.bodyFat / 100);
    return 370 + 21.6 * lbm;
  }
  const base = 10 * weightKg + 6.25 * p.heightCm - 5 * age(p, now);
  return p.sex === 'male' ? base + 5 : base - 161;
}

export function initialExpenditure(p: Profile, weightKg: number, now = new Date()): number {
  const f = ACTIVITY_FACTOR[p.activity] + (p.athlete ? 0.1 : 0);
  return Math.round(bmr(p, weightKg, now) * f);
}

export interface IntakeDay {
  date: string;
  /** Logged kcal; undefined when nothing was logged. */
  kcal?: number;
  partial?: boolean;
  fasted?: boolean;
}

export interface ExpenditurePoint {
  date: string;
  expenditure: number;
  /** Unsmoothed energy-balance estimate for the window ending this day. */
  raw?: number;
  /** True when the estimate was held for lack of data. */
  held: boolean;
  validDays: number;
  /** Value taken from another app's export rather than computed here. */
  imported?: boolean;
}

export interface ExpenditureOptions {
  window?: number;
  /** Required recency of a real weigh-in, in days. */
  weighInWithin?: number;
  /** Expenditure already known for some days (day index → kcal), e.g. imported from MacroFactor. */
  known?: Map<number, number>;
}

/**
 * Adaptive expenditure from energy balance:
 *   expenditure ≈ mean intake − Δtrend × energy density / days
 * evaluated over a trailing window and smoothed day to day. Days that are
 * partially logged or unlogged (and not marked fasted) are ignored; fasted days
 * count as zero intake. Without a recent weigh-in the estimate is held.
 */
export function expenditureSeries(
  intake: IntakeDay[],
  trendKg: TrendPoint[],
  initial: number,
  until: string,
  opts: ExpenditureOptions = {},
): ExpenditurePoint[] {
  const W = opts.window ?? 21;
  const recency = opts.weighInWithin ?? 7;
  if (!trendKg.length && !intake.length) return [];
  const intakeBy = new Map(intake.map((d) => [dayIndex(d.date), d]));
  const trendBy = new Map(trendKg.map((t) => [dayIndex(t.date), t]));
  const weighDays = trendKg.filter((t) => t.weight !== undefined).map((t) => dayIndex(t.date));
  const firstTrend = trendKg.length ? dayIndex(trendKg[0].date) : Infinity;
  const firstIntake = intake.length ? Math.min(...intake.map((d) => dayIndex(d.date))) : Infinity;
  const firstKnown = opts.known?.size ? Math.min(...opts.known.keys()) : Infinity;
  const start = Math.min(firstTrend, firstIntake, firstKnown);
  const end = dayIndex(until);

  const trendAt = (d: number): number | undefined => {
    if (trendBy.has(d)) return trendBy.get(d)!.trend;
    // After the last weigh-in the trend is carried forward.
    let best: TrendPoint | undefined;
    for (const t of trendKg) if (dayIndex(t.date) <= d) best = t;
    return best?.trend;
  };

  const out: ExpenditurePoint[] = [];
  let E = initial;
  // After imported days the estimate continues from the last imported value as a settled one.
  let base = initial;
  let settled = false;
  for (let d = start; d <= end; d++) {
    const k0 = opts.known?.get(d);
    if (k0 !== undefined) {
      E = k0;
      base = k0;
      settled = true;
      out.push({ date: fromIndex(d), expenditure: Math.round(k0), held: false, validDays: 0, imported: true });
      continue;
    }
    const age = settled ? Math.max(14, d - start) : d - start;
    const win = Math.min(W, age + 1);
    let kcal = 0;
    let valid = 0;
    for (let i = d - win + 1; i <= d; i++) {
      const day = intakeBy.get(i);
      if (!day || day.partial) continue;
      if (day.fasted && !day.kcal) {
        valid++;
        continue;
      }
      if (day.kcal && day.kcal > 0) {
        kcal += day.kcal;
        valid++;
      }
    }
    const recentWeigh = weighDays.some((w) => w <= d && w > d - recency);
    const tEnd = trendAt(d);
    const tStart = trendAt(d - win + 1) ?? (firstTrend <= d ? trendKg[0].trend : undefined);
    const enough = valid >= 3 && valid >= win * 0.5 && win >= 3;

    if (!enough || !recentWeigh || tEnd === undefined || tStart === undefined) {
      out.push({ date: fromIndex(d), expenditure: Math.round(E), held: true, validDays: valid });
      continue;
    }
    const span = Math.max(1, win - 1);
    const raw = kcal / valid - ((tEnd - tStart) * KCAL_PER_KG) / span;
    const clamped = Math.min(base * 2, Math.max(base * 0.5, raw));
    const k = age < 14 ? 0.2 : 0.1;
    let next = E + k * (clamped - E);
    if (age >= 14) next = Math.min(E + 50, Math.max(E - 50, next));
    E = next;
    out.push({ date: fromIndex(d), expenditure: Math.round(E), raw: Math.round(raw), held: false, validDays: valid });
  }
  return out;
}
