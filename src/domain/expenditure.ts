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

/** Energy stored per kg of lean and of fat tissue (Hall 2008). */
const KCAL_PER_KG_LEAN = 1816;
const KCAL_PER_KG_FAT = 9440;
/** Forbes' constant: kg of fat mass at which half of a weight change is lean tissue. */
const FORBES_KG = 10.4;

/** Body fat % from BMI, age and sex (Deurenberg 1991), used when none is known. */
export function estimateBodyFat(p: Profile, weightKg: number, now = new Date()): number {
  const bmi = weightKg / (p.heightCm / 100) ** 2;
  const bf = 1.2 * bmi + 0.23 * age(p, now) - (p.sex === 'male' ? 10.8 : 0) - 5.4;
  return Math.min(60, Math.max(4, bf));
}

/**
 * Energy stored per kg of body-mass change for this person (kcal/kg). By Forbes' rule the
 * lean share of a change is 10.4 / (10.4 + fat mass), so leaner people gain and lose more
 * lean tissue, which holds far less energy than fat: about 5 500 kcal/kg for a lean man,
 * 7 700 and up with more body fat. Uses the known body fat when given.
 */
export function energyDensity(p: Profile, weightKg: number, bodyFat?: number, now = new Date()): number {
  const bf = bodyFat !== undefined && bodyFat > 3 && bodyFat < 70 ? bodyFat : estimateBodyFat(p, weightKg, now);
  const fatKg = (weightKg * bf) / 100;
  const lean = FORBES_KG / (FORBES_KG + fatKg);
  return lean * KCAL_PER_KG_LEAN + (1 - lean) * KCAL_PER_KG_FAT;
}


export interface IntakeDay {
  date: string;
  /** Logged kcal; undefined when nothing was logged. */
  kcal?: number;
  /** Logged carbohydrate in grams, used to correct for glycogen-bound water. */
  carbs?: number;
  partial?: boolean;
  fasted?: boolean;
}

export interface ExpenditurePoint {
  date: string;
  expenditure: number;
  /** Typical uncertainty of the estimate (kcal, about one standard deviation). */
  sd?: number;
  /** Unsmoothed energy-balance estimate for the window ending this day. */
  raw?: number;
  /** True when the estimate was held for lack of data. */
  held: boolean;
  validDays: number;
  /** Value taken from another app's export rather than computed here. */
  imported?: boolean;
}

export interface ExpenditureOptions {
  /** Longest stretch of history the regression looks at, in days. */
  window?: number;
  /** Recency weighting (days for weight to fall by e) of weigh-ins and of intake in the regression. */
  weightTau?: number;
  intakeTau?: number;
  /** Required recency of a real weigh-in, in days. */
  weighInWithin?: number;
  /** A break in logging or weighing longer than this restarts the regression window. */
  gapDays?: number;
  /** Days of data before the first update. */
  minDays?: number;
  /** More unlogged days than this in the last 7 holds the estimate. */
  maxMissing?: number;
  /** Expenditure already known for some days (day index → kcal), e.g. imported from MacroFactor. */
  known?: Map<number, number>;
  /** kcal per kg of body-mass change: a constant, or a function of current weight (see `energyDensity`). */
  energyDensity?: number | ((weightKg: number) => number);
  /** Regression: uncertainty of the starting estimate and daily drift of true expenditure (kcal). */
  priorSd?: number;
  driftSd?: number;
  /** Regression: day-to-day scatter of logged intake (kcal). */
  intakeSd?: number;
  /** kg of glycogen-bound mass per unit of √(recent carbs ÷ usual carbs) − 1; 0 turns the correction off. */
  glycogenKg?: number;
  /** Share of the state-space estimate in the reported value; the rest is the regression. */
  stateWeight?: number;
}

interface LineFit {
  /** Fitted weight on the last day of the window. */
  weight: number;
  /** kg per day, with its standard error. */
  slope: number;
  se: number;
}

/** Residuals beyond this many robust standard deviations are down-weighted (Huber). */
const HUBER_K = 2;

/**
 * Weighted least-squares line through weigh-ins (x = days before the last day, w = weight).
 * A few Huber passes keep one odd weigh-in from tilting the line.
 */
function fitLine(pts: { x: number; y: number; w: number }[]): LineFit | undefined {
  if (pts.length < 3) return undefined;
  let robust = pts.map(() => 1);
  let fit: LineFit | undefined;
  for (let pass = 0; pass < 3; pass++) {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    pts.forEach((p, i) => {
      const q = p.w * robust[i];
      sw += q;
      sx += q * p.x;
      sy += q * p.y;
      sxx += q * p.x * p.x;
      sxy += q * p.x * p.y;
    });
    const spread = sxx - (sx * sx) / sw;
    if (spread <= 1e-9) return fit;
    const slope = (sxy - (sx * sy) / sw) / spread;
    const weight = (sy - slope * sx) / sw;
    const res = pts.map((p) => p.y - weight - slope * p.x);
    let rss = 0;
    pts.forEach((p, i) => (rss += p.w * robust[i] * res[i] ** 2));
    const variance = rss / Math.max(1, pts.length - 2) / (sw / pts.length);
    fit = { weight, slope, se: Math.sqrt(variance / spread) };
    const abs = res.map(Math.abs).sort((a, b) => a - b);
    const cut = HUBER_K * Math.max(1.4826 * abs[Math.floor(abs.length / 2)], 0.002 * weight);
    robust = res.map((r) => (Math.abs(r) <= cut ? 1 : cut / Math.abs(r)));
  }
  return fit;
}

/** Daily inputs on a dense index: day `start + i`. */
interface Days {
  start: number;
  n: number;
  /** Intake that counts (complete days; fasted days as 0), else undefined. */
  kcal: (number | undefined)[];
  carbs: (number | undefined)[];
  weight: (number | undefined)[];
  known: (number | undefined)[];
  /** Glycogen-bound water expected from recent carbohydrate intake (kg), known before each day. */
  glycogen: number[];
}

function buildDays(intake: IntakeDay[], trendKg: TrendPoint[], until: string, known: Map<number, number> | undefined, glycogenKg: number): Days | undefined {
  const firstTrend = trendKg.length ? dayIndex(trendKg[0].date) : Infinity;
  const firstIntake = intake.length ? Math.min(...intake.map((d) => dayIndex(d.date))) : Infinity;
  const firstKnown = known?.size ? Math.min(...known.keys()) : Infinity;
  const start = Math.min(firstTrend, firstIntake, firstKnown);
  const end = dayIndex(until);
  if (!Number.isFinite(start) || end < start) return undefined;
  const n = end - start + 1;
  const days: Days = { start, n, kcal: new Array(n), carbs: new Array(n), weight: new Array(n), known: new Array(n), glycogen: new Array(n).fill(0) };
  for (const d of intake) {
    const i = dayIndex(d.date) - start;
    if (i < 0 || i >= n || d.partial) continue;
    if (d.fasted && !d.kcal) days.kcal[i] = 0;
    else if (d.kcal && d.kcal > 0) {
      days.kcal[i] = d.kcal;
      days.carbs[i] = d.carbs;
    }
  }
  for (const t of trendKg) {
    const i = dayIndex(t.date) - start;
    if (i >= 0 && i < n && t.weight !== undefined) days.weight[i] = t.weight;
  }
  if (known) for (const [d, kcal] of known) if (d - start >= 0 && d - start < n) days.known[d - start] = kcal;
  // Glycogen stores (with ~3 g of water per g) follow carbohydrate intake within days. Their
  // steady state scales with √(carb intake), so a switch to low-carb drops 1–2 kg that is not fat.
  // "Usual" carbs adapt only over months (stores re-adapt slowly), so a lasting diet change is not
  // slowly re-read as fat; the pool is finite, so the ratio is capped at ±`glycogenKg`.
  let fast: number | undefined;
  let usual: number | undefined;
  let carbDays = 0;
  for (let i = 0; i < n; i++) {
    if (glycogenKg && fast !== undefined && usual) days.glycogen[i] = glycogenKg * (Math.sqrt(Math.min(4, Math.max(0, fast) / usual)) - 1);
    const c = days.carbs[i];
    if (c === undefined) continue;
    carbDays++;
    fast = fast === undefined ? c : fast + (c - fast) / 2;
    usual = usual === undefined ? c : usual + (c - usual) / Math.min(carbDays, 180);
  }
  return days;
}

interface Estimate {
  value: number[];
  raw: (number | undefined)[];
  held: boolean[];
  valid: number[];
}

/**
 * Rolling regression: a recency-weighted, outlier-robust least-squares line through the
 * (glycogen-corrected) weigh-ins of a trailing window gives the rate of change of stored energy;
 * raw = mean intake − slope × energy density. Each raw value is blended into the running estimate
 * in proportion to its certainty (a one-state Kalman filter). Holds follow MacroFactor V3: no
 * weigh-in for a week, or more than `maxMissing` of the last 7 days unlogged. A longer break
 * restarts the window, since what happened during it is unknown.
 */
function regressionEstimate(days: Days, initial: number, density: (kg: number) => number, o: Required<Omit<ExpenditureOptions, 'known' | 'energyDensity' | 'stateWeight' | 'glycogenKg'>>): Estimate {
  const prior = o.priorSd ** 2;
  const drift = o.driftSd ** 2;
  const intakeVar = o.intakeSd ** 2;
  const out: Estimate = { value: new Array(days.n), raw: new Array(days.n), held: new Array(days.n), valid: new Array(days.n) };
  let E = initial;
  let P = prior;
  let lastLog = -Infinity;
  let lastWeigh = -Infinity;
  let segment = 0;
  for (let d = 0; d < days.n; d++) {
    const logged = days.kcal[d] !== undefined;
    const weighed = days.weight[d] !== undefined;
    if ((logged && d - lastLog > o.gapDays) || (weighed && d - lastWeigh > o.gapDays)) segment = d;
    if (logged) lastLog = d;
    if (weighed) lastWeigh = d;
    const k0 = days.known[d];
    if (k0 !== undefined) {
      // Continue from an imported value as from a settled estimate.
      E = k0;
      P = prior;
      out.value[d] = E;
      out.held[d] = false;
      out.valid[d] = 0;
      continue;
    }
    const lo = Math.max(segment, d - o.window + 1);
    const span = d - lo + 1;
    let valid = 0;
    let missing = 0;
    let kcal = 0;
    let weights = 0;
    const pts: { x: number; y: number; w: number }[] = [];
    for (let i = lo; i <= d; i++) {
      // A morning weigh-in reflects intake up to yesterday, and today's log is rarely complete:
      // intake (and the logging check) stops at yesterday.
      const k = i < d ? days.kcal[i] : undefined;
      if (k !== undefined) {
        const q = Math.exp(-(d - 1 - i) / o.intakeTau);
        kcal += q * k;
        weights += q;
        valid++;
      } else if (i < d && i >= d - 7) missing++;
      const y = days.weight[i];
      if (y !== undefined) pts.push({ x: i - d, y: y - days.glycogen[i], w: Math.exp(-(d - i) / o.weightTau) });
    }
    out.valid[d] = valid;
    const ready = d - lastWeigh < o.weighInWithin && missing <= o.maxMissing && span > o.minDays && valid >= o.minDays;
    const fit = ready ? fitLine(pts) : undefined;
    if (!fit) {
      out.value[d] = E;
      out.held[d] = true;
      continue;
    }
    const rho = density(fit.weight);
    const raw = Math.min(initial * 2, Math.max(initial * 0.5, kcal / weights - fit.slope * rho));
    const noise = (rho * fit.se) ** 2 + intakeVar / valid;
    P += drift;
    const gain = P / (P + noise);
    E += gain * (raw - E);
    P *= 1 - gain;
    out.value[d] = E;
    out.raw[d] = raw;
    out.held[d] = false;
  }
  return out;
}

// State-space model (one step per day). State: tissue mass m (kg), transient water w (kg),
// expenditure T (kcal/day as the food log sees it).
//   m' = m + (intake − T) / ρ      w' = φ·w      T' = T + κ·Δ(intake trend) + drift
//   morning weight = m + w + glycogen water + noise
const STATE = {
  priorSd: 250, // kcal: starting estimate from an equation is typically within ±10 %
  driftSd: 7, // kcal/day random walk of true expenditure
  initMassSd: 1, // kg: an odd first weigh-in must not anchor the mass
  waterSd: 0.25, // kg, stationary sd of transient water
  phi: 0.6, // day-to-day persistence of transient water
  scaleSd: 0.35, // kg, scale and gut-content noise
  logFrac: 0.05, // relative error of a logged day, plus logAbs kcal
  logAbs: 60,
  imputeFrac: 0.2, // relative error of an unlogged day filled with the usual intake
  thermicShare: 0.1, // thermic effect of food: expenditure follows the intake trend by ~10 %
  intakeTau: 14,
  huberK: 2.5,
};

/** sd of the state-space estimate understates real error (model mismatch); ×1.5 gives ~68 % coverage in simulation. */
const SD_CALIBRATION = 1.5;

type Mat = number[][];
const mul = (A: Mat, B: Mat): Mat => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const tr = (A: Mat): Mat => A[0].map((_, j) => A.map((r) => r[j]));
const add = (A: Mat, B: Mat): Mat => A.map((r, i) => r.map((v, j) => v + B[i][j]));

/**
 * Joint Kalman filter over tissue mass, transient water and expenditure: MacroFactor V3's
 * "predict the weight change from intake and current expenditure, then correct expenditure by the
 * prediction error", with the correction sized by the actual uncertainties. Unlogged days are filled
 * with the usual intake (with wide error); with too little logging the fill is uninformative, so weight
 * changes during a break do not move expenditure.
 */
function stateEstimate(days: Days, initial: number, density: (kg: number) => number, maxMissing: number): { value: number[]; sd: number[] } {
  const s = STATE;
  const value = new Array<number>(days.n).fill(initial);
  const sd = new Array<number>(days.n).fill(SD_CALIBRATION * s.priorSd);
  const first = days.weight.findIndex((w) => w !== undefined);
  if (first < 0) return { value, sd };
  let x = [days.weight[first]!, 0, initial];
  let P: Mat = [
    [s.initMassSd ** 2, 0, 0],
    [0, s.waterSd ** 2, 0],
    [0, 0, s.priorSd ** 2],
  ];
  let usual: number | undefined;
  for (let i = 0; i < first; i++) {
    const k = days.kcal[i];
    if (k !== undefined) usual = usual === undefined ? k : usual + (k - usual) / 14;
  }
  let trend: number | undefined;
  const unlogged: number[] = [];
  for (let t = first; t < days.n; t++) {
    const y = days.weight[t];
    if (y !== undefined) {
      let R = s.scaleSd ** 2;
      const nu = y - (x[0] + x[1] + days.glycogen[t]);
      let S = P[0][0] + P[0][1] + P[1][0] + P[1][1] + R;
      const z = Math.abs(nu) / Math.sqrt(S);
      if (z > s.huberK) {
        R *= (z / s.huberK) ** 2;
        S = P[0][0] + P[0][1] + P[1][0] + P[1][1] + R;
      }
      const K = [(P[0][0] + P[0][1]) / S, (P[1][0] + P[1][1]) / S, (P[2][0] + P[2][1]) / S];
      x = x.map((v, i) => v + K[i] * nu);
      const A: Mat = [
        [1 - K[0], -K[0], 0],
        [-K[1], 1 - K[1], 0],
        [-K[2], -K[2], 1],
      ];
      P = add(mul(mul(A, P), tr(A)), K.map((a) => K.map((b) => a * b * R)));
    }
    const k0 = days.known[t];
    if (k0 !== undefined) {
      x[2] = k0;
      P = P.map((r, i) => r.map((v, j) => (i === 2 || j === 2 ? (i === j ? s.priorSd ** 2 / 16 : 0) : v)));
    }
    value[t] = x[2];
    sd[t] = SD_CALIBRATION * Math.sqrt(P[2][2]);

    // Advance to tomorrow with today's intake.
    const k = days.kcal[t];
    const recentMissing = unlogged.filter((d) => d > t - 7).length;
    let I: number;
    let sI: number;
    let dT = 0;
    if (k !== undefined) {
      I = k;
      sI = s.logFrac * k + s.logAbs;
      usual = usual === undefined ? k : usual + (k - usual) / 14;
      const prev = trend;
      trend = trend === undefined ? k : trend + (k - trend) / s.intakeTau;
      if (prev !== undefined) dT = s.thermicShare * (trend - prev);
    } else {
      unlogged.push(t);
      I = usual ?? x[2];
      sI = recentMissing + 1 > maxMissing ? 5000 : s.imputeFrac * I;
    }
    const rho = density(x[0]);
    const F: Mat = [
      [1, 0, -1 / rho],
      [0, s.phi, 0],
      [0, 0, 1],
    ];
    x = [x[0] + (I - x[2]) / rho, s.phi * x[1], x[2] + dT];
    const Q: Mat = [
      [(sI / rho) ** 2 + 0.02 ** 2, 0, 0],
      [0, s.waterSd ** 2 * (1 - s.phi ** 2), 0],
      [0, 0, s.driftSd ** 2],
    ];
    P = add(mul(mul(F, P), tr(F)), Q);
  }
  return { value, sd };
}

/**
 * Adaptive expenditure from energy balance: what you burn = what you logged − the energy that went
 * into (or came out of) body stores. Two independent estimators read the same data and are averaged
 * (combining forecasts cancels part of each one's error):
 *  1. a rolling, outlier-robust regression of weight against time over recent weeks, and
 *  2. a joint Kalman filter that predicts tomorrow's weight from intake and expenditure and corrects
 *     expenditure by the miss (MacroFactor V3's published principle, with optimal gains).
 * Both use the same physiology: energy per kg of change from body composition (Forbes, Hall), and
 * weights corrected for glycogen-bound water when carbohydrate intake changes.
 *
 * Partially logged days and unlogged days (not marked fasted) do not count as intake; fasted days
 * count as zero. The estimate is held — kept at its last value — without a weigh-in in the last week
 * or when more than 3 of the last 7 days are unlogged.
 */
export function expenditureSeries(
  intake: IntakeDay[],
  trendKg: TrendPoint[],
  initial: number,
  until: string,
  opts: ExpenditureOptions = {},
): ExpenditurePoint[] {
  const o = {
    window: opts.window ?? 70,
    weightTau: opts.weightTau ?? 14,
    intakeTau: opts.intakeTau ?? 14,
    weighInWithin: opts.weighInWithin ?? 7,
    gapDays: opts.gapDays ?? 7,
    minDays: opts.minDays ?? 3,
    maxMissing: opts.maxMissing ?? 3,
    priorSd: opts.priorSd ?? 40,
    driftSd: opts.driftSd ?? 4.5,
    intakeSd: opts.intakeSd ?? 150,
  };
  if (!trendKg.length && !intake.length) return [];
  const dens = opts.energyDensity ?? KCAL_PER_KG;
  const density = typeof dens === 'number' ? () => dens : dens;
  const days = buildDays(intake, trendKg, until, opts.known, opts.glycogenKg ?? 1.85);
  if (!days) return [];
  const reg = regressionEstimate(days, initial, density, o);
  const state = stateEstimate(days, initial, density, o.maxMissing);
  const share = opts.stateWeight ?? 0.5;

  const out: ExpenditurePoint[] = [];
  let shown = initial;
  for (let i = 0; i < days.n; i++) {
    const date = fromIndex(days.start + i);
    const k0 = days.known[i];
    if (k0 !== undefined) {
      shown = k0;
      out.push({ date, expenditure: Math.round(k0), held: false, validDays: 0, imported: true });
      continue;
    }
    const held = reg.held[i];
    if (!held) shown = (1 - share) * reg.value[i] + share * state.value[i];
    const raw = reg.raw[i];
    out.push({
      date,
      expenditure: Math.round(shown),
      sd: Math.round(state.sd[i]),
      ...(raw !== undefined ? { raw: Math.round(raw) } : {}),
      held,
      validDays: reg.valid[i],
    });
  }
  return out;
}
