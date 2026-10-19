import { fromKg, toKg } from './coach';
import { dayTotals } from './nutrition';
import { unusualWeights } from './body';
import type { BodyEntry, DayMeta, LogEntry, WeightUnit } from './types';
import { isoDate } from './util';

/**
 * Health Connect merge rules (FR-32). Pure functions only: the Settings screen reads and writes
 * Health Connect through src/platform/health and uses these to decide what changes.
 *
 * - Imported values never overwrite a value the app already has for the same date and field.
 * - Imported weights arrive in kg and are converted to the user's unit.
 * - Duplicates are skipped, in both directions.
 * - Steps are display-only (they never feed expenditure).
 */

export type HealthField = 'weight' | 'bodyFat' | 'steps';
export type HealthWriteType = 'weight' | 'bodyFat' | 'dietaryEnergyConsumed' | 'dietaryWater';

/** One value per local day, as returned by the platform adapter. Weight in kg, body fat in %. */
export interface HealthDaySample {
  date: string;
  value: number;
}

/** Samples read from Health Connect. A missing field means "not read" (unknown), not "empty". */
export type HealthSamples = Partial<Record<HealthField, HealthDaySample[]>>;

export interface ImportPlan {
  /** Partial body entries to save; each holds only the fields that are new for that date. */
  patches: BodyEntry[];
  imported: number;
  skipped: number;
  /** Weights left out because they were far from the days around them. */
  unusual: { date: string; weight: number; typical: number }[];
}

export interface HealthWrite {
  type: HealthWriteType;
  date: string;
  /** kg for weight, % for body fat, kcal for energy, liters for water. */
  value: number;
}

export const DEFAULT_SYNC_DAYS = 90;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FIELDS: HealthField[] = ['weight', 'bodyFat', 'steps'];

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Body fat as a percentage; some sources report a fraction (0.18 for 18 %). */
export function normalizeBodyFat(v: number): number {
  return v > 0 && v <= 1 ? v * 100 : v;
}

const plausible: Record<HealthField, (v: number) => boolean> = {
  weight: (kg) => kg >= 20 && kg <= 400,
  bodyFat: (pct) => pct >= 2 && pct <= 75,
  steps: (n) => n >= 0 && n <= 200_000,
};

/** Convert an imported sample to the value stored in the app, or undefined when it is not usable. */
export function importValue(field: HealthField, raw: number, unit: WeightUnit): number | undefined {
  if (!Number.isFinite(raw)) return undefined;
  const v = field === 'bodyFat' ? normalizeBodyFat(raw) : raw;
  if (!plausible[field](v)) return undefined;
  if (field === 'weight') return round(fromKg(v, unit), 1);
  if (field === 'bodyFat') return round(v, 1);
  return Math.round(v);
}

/**
 * First local date (YYYY-MM-DD) covered by a sync. With a previous sync the window starts on that
 * sync's day, so a day that was still in progress last time is looked at again. Without one it
 * reaches back `days` days.
 */
export function syncStartDate(lastSync: string | undefined, now: Date, days = DEFAULT_SYNC_DAYS): string {
  if (lastSync) {
    if (DATE_RE.test(lastSync)) return lastSync;
    const t = Date.parse(lastSync);
    if (!Number.isNaN(t)) return isoDate(Math.min(t, now.getTime()));
  }
  const d = new Date(now.getTime());
  d.setDate(d.getDate() - days);
  return isoDate(d);
}

/** Merge imported samples into body entries without overwriting anything the app already has. */
export function planHealthImport(body: BodyEntry[], samples: HealthSamples, unit: WeightUnit): ImportPlan {
  const existing = new Map(body.map((b) => [b.date, b]));
  const patches = new Map<string, BodyEntry>();
  let imported = 0;
  let skipped = 0;
  for (const field of FIELDS) {
    for (const s of samples[field] ?? []) {
      if (!DATE_RE.test(s.date)) {
        skipped++;
        continue;
      }
      const value = importValue(field, s.value, unit);
      const patch = patches.get(s.date);
      if (value === undefined || existing.get(s.date)?.[field] !== undefined || patch?.[field] !== undefined) {
        skipped++;
        continue;
      }
      patches.set(s.date, { ...(patch ?? { date: s.date }), [field]: value });
      imported++;
    }
  }
  // A weight far from the days around it (a default or mistyped value written by some app) is not
  // pulled in; it would otherwise drag the trend and expenditure.
  const unusual = unusualWeights([...patches.values()], body);
  for (const u of unusual) {
    const p = patches.get(u.date)!;
    const rest: BodyEntry = { ...p, weight: undefined };
    imported--;
    skipped++;
    if (Object.entries(rest).some(([k, v]) => k !== 'date' && v !== undefined)) patches.set(u.date, JSON.parse(JSON.stringify(rest)));
    else patches.delete(u.date);
  }
  return { patches: [...patches.values()].sort((a, b) => a.date.localeCompare(b.date)), imported, skipped, unusual };
}

export interface ExportInput {
  body: BodyEntry[];
  log: LogEntry[];
  meta: DayMeta[];
  unit: WeightUnit;
  /** First date covered (see syncStartDate). */
  from: string;
  /** Today's local date. Body values up to today are written; nutrition only for finished days. */
  today: string;
  writeNutrition: boolean;
  /**
   * What Health Connect already holds for the same window. Weight or body fat is written only
   * when that field was read successfully and Health Connect has no value for the date.
   */
  existing: HealthSamples;
}

/** Values to write to Health Connect, oldest first. */
export function planHealthExport(i: ExportInput): HealthWrite[] {
  const out: HealthWrite[] = [];
  const known = (field: 'weight' | 'bodyFat') => (i.existing[field] ? new Set(i.existing[field]!.map((s) => s.date)) : undefined);
  const hcWeight = known('weight');
  const hcFat = known('bodyFat');
  for (const b of [...i.body].sort((x, y) => x.date.localeCompare(y.date))) {
    if (b.date < i.from || b.date > i.today) continue;
    if (b.weight !== undefined && hcWeight && !hcWeight.has(b.date)) out.push({ type: 'weight', date: b.date, value: round(toKg(b.weight, i.unit), 2) });
    if (b.bodyFat !== undefined && hcFat && !hcFat.has(b.date)) out.push({ type: 'bodyFat', date: b.date, value: round(b.bodyFat, 1) });
  }
  if (!i.writeNutrition) return out;

  // Nutrition cannot be read back, so each finished day is written once: days before the previous
  // sync's date were finished then and already written; today is still in progress.
  const byDate = new Map<string, LogEntry[]>();
  for (const e of i.log) {
    if (e.date < i.from || e.date >= i.today) continue;
    byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  }
  const water = new Map(i.meta.filter((m) => m.date >= i.from && m.date < i.today && (m.waterMl ?? 0) > 0).map((m) => [m.date, m.waterMl!]));
  const dates = [...new Set([...byDate.keys(), ...water.keys()])].sort();
  for (const date of dates) {
    const kcal = byDate.has(date) ? Math.round(dayTotals(byDate.get(date)!).kcal ?? 0) : 0;
    if (kcal > 0) out.push({ type: 'dietaryEnergyConsumed', date, value: kcal });
    const ml = water.get(date);
    if (ml) out.push({ type: 'dietaryWater', date, value: round(ml / 1000, 3) });
  }
  return out;
}

/**
 * Timestamp for a written sample. Entries only carry a date, so past days are stamped at local noon;
 * today's values are stamped now so nothing lands in the future.
 */
export function sampleTime(date: string, now: Date): Date {
  const noon = new Date(`${date}T12:00:00`);
  return noon.getTime() > now.getTime() ? new Date(now.getTime()) : noon;
}
