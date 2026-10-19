import { age, bmr, KCAL_PER_KG } from './expenditure';
import type { CalorieFloor, DietType, Goal, MacroTarget, Profile, ProteinPref } from './types';

/** Protein in g per kg of reference body mass. */
export const PROTEIN_G_PER_KG: Record<ProteinPref, number> = {
  low: 1.2,
  moderate: 1.6,
  high: 2.0,
  extraHigh: 2.4,
};

export const DIET_LABELS: Record<DietType, { title: string; desc: string }> = {
  balanced: { title: 'Balanced', desc: 'Fat at roughly a third of your calories, carbs fill the rest.' },
  lowFat: { title: 'Low-fat', desc: 'Less fat, which leaves more room for carbs next to your protein.' },
  lowCarb: { title: 'Low-carb', desc: 'Fewer carbs, with fat making up more of your calories.' },
  keto: { title: 'Keto', desc: 'Carbs kept very low, so most of your calories come from fat.' },
};

export const PROTEIN_LABELS: Record<ProteinPref, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  extraHigh: 'Extra high',
};

/** Under 18 the coach uses conservative limits whatever the goal says. */
export const isMinor = (p: Profile, now = new Date()) => age(p, now) < 18;

/**
 * The goal as the coach applies it: "none" floors (from older versions or imports) act as "low",
 * and people under 18 always get the standard floor and at most 0.5 % loss per week.
 */
export function safeGoal<G extends Pick<Goal, 'floor' | 'ratePct' | 'type'>>(g: G, p: Profile): G {
  if (isMinor(p)) return { ...g, floor: 'standard', ratePct: g.type === 'lose' ? Math.min(g.ratePct, 0.5) : g.ratePct };
  return g.floor === 'none' ? { ...g, floor: 'low' } : g;
}

/** Lowest daily calories the coach will prescribe. */
export function calorieFloor(floor: CalorieFloor, p: Profile, weightKg: number): number {
  const base = p.sex === 'male' ? 1500 : 1200;
  const low = p.sex === 'male' ? 1200 : 1000;
  // "none" is no longer offered; it maps to the low floor so targets never fall below it.
  return floor === 'standard' ? Math.max(base, Math.round(bmr(p, weightKg) * 0.9)) : low;
}

/** Reference mass for protein: lean mass when known, otherwise capped at BMI 27 weight. */
export function proteinReferenceKg(p: Profile, weightKg: number): number {
  if (p.bodyFat !== undefined) return (weightKg * (1 - p.bodyFat / 100)) / 0.85;
  const cap = 27 * (p.heightCm / 100) ** 2;
  return Math.min(weightKg, cap);
}

/** Signed daily energy delta for the goal rate (negative when losing). */
export function goalDailyDelta(g: Pick<Goal, 'type' | 'ratePct'>, weightKg: number): number {
  if (g.type === 'maintain') return 0;
  const kgPerWeek = (g.ratePct / 100) * weightKg;
  const d = (kgPerWeek * KCAL_PER_KG) / 7;
  return g.type === 'lose' ? -d : d;
}

function split(kcal: number, protein: number, diet: DietType, weightKg: number): { carbs: number; fat: number } {
  const rest = Math.max(0, kcal - protein * 4);
  let fat: number;
  let carbs: number;
  switch (diet) {
    case 'keto':
      carbs = Math.min(30, rest / 4);
      fat = (rest - carbs * 4) / 9;
      break;
    case 'lowCarb':
      carbs = (kcal * 0.15) / 4;
      fat = (rest - carbs * 4) / 9;
      break;
    case 'lowFat':
      fat = Math.max(0.5 * weightKg, (kcal * 0.2) / 9);
      carbs = (rest - fat * 9) / 4;
      break;
    default:
      fat = Math.max(0.6 * weightKg, (kcal * 0.3) / 9);
      carbs = (rest - fat * 9) / 4;
  }
  if (carbs < 0) {
    fat += (carbs * 4) / 9;
    carbs = 0;
  }
  return { carbs: Math.max(0, carbs), fat: Math.max(0, fat) };
}

export interface TargetResult {
  average: number;
  targets: MacroTarget[];
  flooredBy?: number;
}

/** Coached targets for each weekday (Monday first). */
export function coachedTargets(goal: Goal, expenditure: number, weightKg: number, p: Profile): TargetResult {
  const g = safeGoal(goal, p);
  const floor = calorieFloor(g.floor, p, weightKg);
  let avg = expenditure + goalDailyDelta(g, weightKg);
  let flooredBy: number | undefined;
  if (avg < floor) {
    flooredBy = floor - avg;
    avg = floor;
  }
  const protein = Math.round(PROTEIN_G_PER_KG[g.protein] * proteinReferenceKg(p, weightKg));

  const highs = g.highDays.filter((d) => d >= 0 && d < 7);
  const shift = highs.length && highs.length < 7 ? Math.min(0.3, Math.max(0, g.highShift)) : 0;
  const weekly = avg * 7;
  const extraPerHigh = (weekly * shift) / Math.max(1, highs.length);
  const cutPerLow = (weekly * shift) / Math.max(1, 7 - highs.length);

  const targets = Array.from({ length: 7 }, (_, wd) => {
    let kcal = shift ? avg + (highs.includes(wd) ? extraPerHigh : -cutPerLow) : avg;
    kcal = Math.max(kcal, Math.min(avg, floor));
    const { carbs, fat } = split(kcal, protein, g.diet, weightKg);
    const c = Math.round(carbs);
    const f = Math.round(fat);
    return { kcal: Math.round(protein * 4 + c * 4 + f * 9), protein, carbs: c, fat: f };
  });
  return { average: Math.round(targets.reduce((t, x) => t + x.kcal, 0) / 7), targets, flooredBy };
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const weekdayOf = (iso: string) => (new Date(iso + 'T00:00:00').getDay() + 6) % 7;

/** Rate presets in % body weight per week. */
export const RATE_PRESETS: Record<'lose' | 'gain', { label: string; pct: number }[]> = {
  lose: [
    { label: 'Relaxed', pct: 0.25 },
    { label: 'Moderate', pct: 0.5 },
    { label: 'Fast', pct: 0.75 },
    { label: 'Aggressive', pct: 1.0 },
  ],
  gain: [
    { label: 'Lean', pct: 0.1 },
    { label: 'Moderate', pct: 0.25 },
    { label: 'Fast', pct: 0.5 },
  ],
};
