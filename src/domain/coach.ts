import { expenditureSeries, initialExpenditure, LB_PER_KG, type ExpenditurePoint, type IntakeDay } from './expenditure';
import { coachedTargets, weekdayOf, WEEKDAYS } from './targets';
import { dailyTrend, dayIndex, fromIndex, trendRate, type TrendPoint } from './trend';
import type { BodyEntry, DayMeta, Goal, LogEntry, MacroTarget, Profile, TargetSnapshot, WeightUnit } from './types';

export const toKg = (w: number, u: WeightUnit) => (u === 'kg' ? w : w / LB_PER_KG);
export const fromKg = (kg: number, u: WeightUnit) => (u === 'kg' ? kg : kg * LB_PER_KG);

export function intakeDays(log: LogEntry[], meta: DayMeta[]): IntakeDay[] {
  const by = new Map<string, IntakeDay>();
  for (const e of log) {
    const d = by.get(e.date) ?? { date: e.date, kcal: 0 };
    d.kcal = (d.kcal ?? 0) + (e.n.kcal ?? 0);
    by.set(e.date, d);
  }
  for (const m of meta) {
    const d = by.get(m.date) ?? { date: m.date };
    d.partial = m.partial;
    d.fasted = m.fasted;
    by.set(m.date, d);
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface CoachInput {
  log: LogEntry[];
  meta: DayMeta[];
  body: BodyEntry[];
  profile: Profile;
  unit: WeightUnit;
  trendAlpha: number;
  /** Robust trend that revises the past (default) or past-only smoothing. */
  trendRevise?: boolean;
  /** Expenditure imported from another app; Satiago continues from it. */
  knownExpenditure?: { date: string; kcal: number }[];
  today: string;
  /** Starting weight used before any weigh-in (in `unit`). */
  fallbackWeight: number;
}

export interface CoachAnalysis {
  trend: TrendPoint[]; // in user unit
  trendKg: TrendPoint[];
  expenditure: ExpenditurePoint[];
  initial: number;
  current: number;
  currentWeightKg: number;
  ratePerWeek?: number; // user unit
  held: boolean;
}

export function analyze(i: CoachInput): CoachAnalysis {
  const bodyKg = i.body.map((b) => (b.weight === undefined ? b : { ...b, weight: toKg(b.weight, i.unit) }));
  const trendKg = dailyTrend(bodyKg, i.trendAlpha, i.today, i.trendRevise ?? true);
  const trend = trendKg.map((t) => ({
    date: t.date,
    weight: t.weight === undefined ? undefined : Math.round(fromKg(t.weight, i.unit) * 10) / 10,
    trend: Math.round(fromKg(t.trend, i.unit) * 100) / 100,
  }));
  const firstKg = trendKg[0]?.trend ?? toKg(i.fallbackWeight, i.unit);
  const currentWeightKg = trendKg.at(-1)?.trend ?? toKg(i.fallbackWeight, i.unit);
  const initial = initialExpenditure(i.profile, firstKg);
  const known = i.knownExpenditure?.length ? new Map(i.knownExpenditure.map((k) => [dayIndex(k.date), k.kcal])) : undefined;
  const expenditure = expenditureSeries(intakeDays(i.log, i.meta), trendKg, initial, i.today, { known });
  const last = expenditure.at(-1);
  return {
    trend,
    trendKg,
    expenditure,
    initial,
    current: last?.expenditure ?? initial,
    currentWeightKg,
    ratePerWeek: trendRate(trend),
    held: last?.held ?? true,
  };
}

/** Active snapshot for a date: the latest one dated on or before it. */
export function snapshotFor(date: string, snapshots: TargetSnapshot[]): TargetSnapshot | undefined {
  let best: TargetSnapshot | undefined;
  for (const s of snapshots) if (s.date <= date && (!best || s.date >= best.date)) best = s;
  return best;
}

export function targetFor(date: string, goal: Goal | undefined, snapshots: TargetSnapshot[]): MacroTarget | undefined {
  if (!goal) return undefined;
  const wd = weekdayOf(date);
  if (goal.style === 'manual' && goal.manual) return goal.manual[wd];
  // This goal's own targets win; earlier goals' snapshots only cover days before its first one.
  return (snapshotFor(date, snapshots.filter((s) => s.goalId === goal.id)) ?? snapshotFor(date, snapshots))?.targets[wd];
}

export function buildSnapshot(goal: Goal, a: CoachAnalysis, profile: Profile, date: string, previous?: TargetSnapshot): TargetSnapshot {
  const res = coachedTargets(goal, a.current, a.currentWeightKg, profile);
  const delta = previous ? res.average - Math.round(previous.targets.reduce((t, x) => t + x.kcal, 0) / 7) : 0;
  const parts = [
    `Expenditure ${a.current} kcal${a.held ? ' (held: log weight and food to update)' : ''}.`,
    goal.type === 'maintain'
      ? 'Targets match expenditure to maintain weight.'
      : `Targets aim for ${goal.ratePct}% of body weight per week.`,
  ];
  if (previous) parts.push(delta === 0 ? 'No change from last week.' : `${delta > 0 ? '+' : ''}${delta} kcal/day vs last week.`);
  if (res.flooredBy) parts.push(`Raised ${Math.round(res.flooredBy)} kcal to respect your calorie floor.`);
  return { date, goalId: goal.id, expenditure: a.current, targets: res.targets, reason: parts.join(' ') };
}

export function checkInDue(goal: Goal | undefined, snapshots: TargetSnapshot[], today: string): boolean {
  if (!goal || goal.style === 'manual') return false;
  const last = snapshotFor(today, snapshots.filter((s) => s.goalId === goal.id));
  if (!last) return true;
  const since = dayIndex(today) - dayIndex(last.date);
  return since >= 7 || (since >= 1 && weekdayOf(today) === goal.checkInDay && since >= 6);
}

export function nextCheckIn(goal: Goal, today: string): string {
  const wd = weekdayOf(today);
  const add = (goal.checkInDay - wd + 7) % 7 || 7;
  return fromIndex(dayIndex(today) + add);
}

export const weekdayName = (i: number) => WEEKDAYS[i];

/** Consecutive days ending today (or yesterday) with food logged or marked fasted. */
export function loggingStreak(log: LogEntry[], meta: DayMeta[], today: string): number {
  const days = new Set([...log.map((e) => e.date), ...meta.filter((m) => m.fasted).map((m) => m.date)]);
  let d = dayIndex(today);
  if (!days.has(fromIndex(d))) d--;
  let n = 0;
  while (days.has(fromIndex(d))) {
    n++;
    d--;
  }
  return n;
}

/** Days in the last `n` (incl. today) with at least one weigh-in. */
export function weighInCount(body: BodyEntry[], today: string, n = 7): number {
  const from = dayIndex(today) - n + 1;
  return body.filter((b) => b.weight !== undefined && dayIndex(b.date) >= from && dayIndex(b.date) <= dayIndex(today)).length;
}

/** Goal progress (0–1) from start weight toward goal weight using trend weight. */
export function goalProgress(goal: Goal, trendWeight: number | undefined): number | undefined {
  if (goal.goalWeight === undefined || trendWeight === undefined || goal.goalWeight === goal.startWeight) return undefined;
  return Math.max(0, Math.min(1, (trendWeight - goal.startWeight) / (goal.goalWeight - goal.startWeight)));
}
