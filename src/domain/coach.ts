import { energyDensity, expenditureSeries, initialExpenditure, LB_PER_KG, LEAN_SPARING, type ExpenditurePoint, type IntakeDay } from './expenditure';
import { coachedTargets, weekdayOf, WEEKDAYS } from './targets';
import { dailyTrend, dayIndex, fromIndex, trendRate, type TrendPoint } from './trend';
import type { BodyEntry, DayMeta, Goal, LogEntry, MacroTarget, Profile, TargetSnapshot, WeightUnit } from './types';

export const toKg = (w: number, u: WeightUnit) => (u === 'kg' ? w : w / LB_PER_KG);
export const fromKg = (kg: number, u: WeightUnit) => (u === 'kg' ? kg : kg * LB_PER_KG);

export function intakeDays(log: LogEntry[], meta: DayMeta[]): IntakeDay[] {
  const by = new Map<string, IntakeDay>();
  // Carbs count only for days where every entry with calories has them; a gap would look like a carb drop.
  const carbsMissing = new Set<string>();
  for (const e of log) {
    const d = by.get(e.date) ?? { date: e.date, kcal: 0, carbs: 0 };
    d.kcal = (d.kcal ?? 0) + (e.n.kcal ?? 0);
    if (e.n.carbs !== undefined) d.carbs = (d.carbs ?? 0) + e.n.carbs;
    else if ((e.n.kcal ?? 0) > 0) carbsMissing.add(e.date);
    by.set(e.date, d);
  }
  for (const date of carbsMissing) delete by.get(date)!.carbs;
  for (const m of meta) {
    const d = by.get(m.date) ?? { date: m.date };
    d.partial = m.partial;
    d.fasted = m.fasted;
    by.set(m.date, d);
  }
  const days = [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
  // A day far below the usual intake was almost always logged only in part (a forgotten meal), and would
  // read as a big deficit. It is left out unless the user marked it complete (`partial: false`).
  const usual: number[] = [];
  for (const d of days) {
    if (d.partial === undefined && !d.fasted && d.kcal && usual.length >= 7) {
      const sorted = [...usual].sort((a, b) => a - b);
      if (d.kcal < INCOMPLETE_SHARE * sorted[Math.floor(sorted.length / 2)]) {
        d.partial = true;
        d.autoPartial = true;
      }
    }
    if (!d.partial && d.kcal) {
      usual.push(d.kcal);
      if (usual.length > 14) usual.shift();
    }
  }
  return days;
}

/** A logged day below this share of the usual intake (median of the previous 14 logged days) counts as incomplete. */
const INCOMPLETE_SHARE = 0.5;

/** Protein that keeps most lean tissue: at least 1.6 g/kg a day on average over 14+ logged days of the last 4 weeks. */
export function proteinAdequate(log: LogEntry[], weightKg: number, today: string): boolean {
  const from = fromIndex(dayIndex(today) - 28);
  const by = new Map<string, number>();
  for (const e of log) if (e.date >= from && e.date < today && (e.n.kcal ?? 0) > 0) by.set(e.date, (by.get(e.date) ?? 0) + (e.n.protein ?? 0));
  if (by.size < 14) return false;
  let sum = 0;
  for (const p of by.values()) sum += p;
  return sum / by.size >= 1.6 * weightKg;
}

/** Average intake of the complete days in the last 14 (at least 10): the level expenditure has adapted to. */
export function recentIntake(intake: IntakeDay[], today: string): number | undefined {
  const from = fromIndex(dayIndex(today) - 14);
  const k = intake.filter((d) => d.date >= from && d.date < today && !d.partial && (d.kcal !== undefined || d.fasted)).map((d) => d.kcal ?? 0);
  return k.length >= 10 ? k.reduce((a, b) => a + b, 0) / k.length : undefined;
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
  /** Typical uncertainty of `current` (kcal, about one standard deviation). */
  currentSd?: number;
  currentWeightKg: number;
  /** Energy per kg of body-mass change at the current weight (see `energyDensity`). */
  kcalPerKg: number;
  /** Logged protein is high enough that lean tissue is mostly kept (see `LEAN_SPARING`). */
  leanSparing: boolean;
  /** Average intake of the last two weeks (see `recentIntake`). */
  recentIntake?: number;
  ratePerWeek?: number; // user unit
  held: boolean;
}

/** Body fat % to use: the profile's, else the latest logged one, else undefined (estimated later). */
export function knownBodyFat(profile: Profile, body: BodyEntry[]): number | undefined {
  if (profile.bodyFat !== undefined) return profile.bodyFat;
  let latest: BodyEntry | undefined;
  for (const b of body) if (b.bodyFat !== undefined && (!latest || b.date > latest.date)) latest = b;
  return latest?.bodyFat;
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
  const bodyFat = knownBodyFat(i.profile, i.body);
  const leanSparing = proteinAdequate(i.log, currentWeightKg, i.today);
  const density = (kg: number) => energyDensity(i.profile, kg, bodyFat, { leanScale: leanSparing ? LEAN_SPARING : 1 });
  const intake = intakeDays(i.log, i.meta);
  const expenditure = expenditureSeries(intake, trendKg, initial, i.today, { known, energyDensity: density });
  const last = expenditure.at(-1);
  return {
    trend,
    trendKg,
    expenditure,
    initial,
    current: last?.expenditure ?? initial,
    currentSd: last?.sd,
    currentWeightKg,
    kcalPerKg: density(currentWeightKg),
    leanSparing,
    recentIntake: recentIntake(intake, i.today),
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

/** Version of the target method; snapshots from an older one are recalculated automatically. */
export const TARGET_ALGO = 2;

export function buildSnapshot(goal: Goal, a: CoachAnalysis, profile: Profile, date: string, previous?: TargetSnapshot, note?: string): TargetSnapshot {
  const res = coachedTargets(goal, a.current, a.currentWeightKg, profile, a.kcalPerKg, a.recentIntake);
  const delta = previous ? res.average - Math.round(previous.targets.reduce((t, x) => t + x.kcal, 0) / 7) : 0;
  const parts = [
    `Expenditure ${a.current} kcal${a.held ? ' (held: log weight and food to update)' : ''}.`,
    goal.type === 'maintain'
      ? 'Targets match expenditure to maintain weight.'
      : `Targets aim for ${goal.ratePct}% of body weight per week.`,
  ];
  // A same-day recalculation compares with the targets it replaces, not with last week's.
  const since = previous?.date === date ? 'your previous targets' : 'last week';
  if (previous) parts.push(delta === 0 ? `No change from ${since}.` : `${delta > 0 ? '+' : ''}${delta} kcal/day vs ${since}.`);
  if (res.flooredBy) parts.push(`Raised ${Math.round(res.flooredBy)} kcal to respect your calorie floor.`);
  if (note) parts.push(note);
  return { date, goalId: goal.id, expenditure: a.current, targets: res.targets, reason: parts.join(' '), algo: TARGET_ALGO };
}

/**
 * The weekly update, made without asking: a new snapshot when a check-in is due, or this week's targets
 * recalculated when an older version of the method set them. Undefined when nothing needs to change.
 */
export function autoSnapshot(goal: Goal | undefined, snapshots: TargetSnapshot[], a: CoachAnalysis, profile: Profile, today: string): TargetSnapshot | undefined {
  if (!goal || goal.style === 'manual' || goal.endedAt) return undefined;
  const last = snapshotFor(today, snapshots.filter((s) => s.goalId === goal.id));
  if (checkInDue(goal, snapshots, today)) return buildSnapshot(goal, a, profile, today, last);
  if (last && (last.algo ?? 1) < TARGET_ALGO && dayIndex(today) - dayIndex(last.date) < 7)
    return buildSnapshot(goal, a, profile, today, last, 'Recalculated with the updated expenditure model.');
  return undefined;
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
