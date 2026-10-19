import type { BodyEntry } from './types';

export interface TrendPoint {
  date: string;
  /** Scale weight logged that day, if any. */
  weight?: number;
  trend: number;
}

const DAY = 86400000;
export const dayIndex = (iso: string) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);
export const fromIndex = (i: number) => new Date(i * DAY).toISOString().slice(0, 10);

/**
 * Daily trend weight for every calendar day from the first weigh-in to `until`.
 * Forward pass: exponential smoothing where missing days only decay the gain.
 * Outliers (> 3 × typical daily noise from the trend) are softened before smoothing.
 * With `revise`, a backward pass blends in later weigh-ins, which reduces lag
 * (past trend values can change when new data arrives).
 */
export function dailyTrend(entries: BodyEntry[], alpha = 0.1, until?: string, revise = true): TrendPoint[] {
  const pts = entries
    .filter((e) => e.weight !== undefined && e.weight > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!pts.length) return [];
  const byDay = new Map(pts.map((p) => [dayIndex(p.date), p.weight!]));
  const start = dayIndex(pts[0].date);
  const end = Math.max(dayIndex(until ?? pts[pts.length - 1].date), dayIndex(pts[pts.length - 1].date));

  const fwd: number[] = [];
  let t = pts[0].weight!;
  let noise = 0.6 * (t / 100); // ≈0.6 % of body weight is a typical daily swing
  for (let d = start; d <= end; d++) {
    const w = byDay.get(d);
    if (w !== undefined) {
      const dev = w - t;
      const capped = Math.abs(dev) > 3 * noise ? Math.sign(dev) * 3 * noise : dev;
      noise = 0.9 * noise + 0.1 * Math.max(Math.abs(dev), 0.002 * t);
      t = t + alpha * capped;
    }
    fwd.push(t);
  }

  let out = fwd;
  if (revise && fwd.length > 2) {
    const bwd = new Array<number>(fwd.length);
    let b = fwd[fwd.length - 1];
    for (let i = fwd.length - 1; i >= 0; i--) {
      const w = byDay.get(start + i);
      if (w !== undefined) b = b + alpha * (w - b);
      bwd[i] = b;
    }
    // Weight the backward pass less near the end, where it has seen little data.
    out = fwd.map((f, i) => {
      const ahead = Math.min(1, (fwd.length - 1 - i) / 14);
      return f * (1 - 0.5 * ahead) + bwd[i] * 0.5 * ahead;
    });
  }
  return out.map((v, i) => ({ date: fromIndex(start + i), weight: byDay.get(start + i), trend: Math.round(v * 100) / 100 }));
}

/** Weekly rate of change of the trend over the last `days` days (units per week). */
export function trendRate(trend: TrendPoint[], days = 14): number | undefined {
  if (trend.length < 2) return undefined;
  const last = trend[trend.length - 1];
  const first = trend[Math.max(0, trend.length - 1 - days)];
  const span = dayIndex(last.date) - dayIndex(first.date);
  return span > 0 ? ((last.trend - first.trend) / span) * 7 : undefined;
}

/** Projected trend weight `days` ahead. Blends observed rate and goal rate per `style`. */
export function projectWeight(current: number, observedPerWeek: number | undefined, goalPerWeek: number, days: number, style: 'data' | 'blend' | 'goal' = 'blend'): number {
  const obs = observedPerWeek ?? goalPerWeek;
  const rate = style === 'goal' ? goalPerWeek : style === 'data' ? obs : (obs + goalPerWeek) / 2;
  return current + (rate * days) / 7;
}
