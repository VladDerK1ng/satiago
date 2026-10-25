import type { AiProviderId } from './aiProviders';

export type WeightUnit = 'kg' | 'lb';
export type EnergyUnit = 'kcal' | 'kJ';
export type LengthUnit = 'cm' | 'in';
export type ClockStyle = '24h' | '12h';

/** Tape measurements, stored in centimetres whatever the display unit. */
export const MEASUREMENT_KEYS = [
  'waist',
  'hips',
  'chest',
  'bust',
  'neck',
  'shoulders',
  'leftBicep',
  'rightBicep',
  'leftForearm',
  'rightForearm',
  'leftWrist',
  'rightWrist',
  'leftThigh',
  'rightThigh',
  'leftCalf',
  'rightCalf',
  'leftAnkle',
  'rightAnkle',
] as const;
export type MeasurementKey = (typeof MEASUREMENT_KEYS)[number];

/** Actions the Food Log + button can offer, in the user's order. */
export const SHORTCUT_IDS = ['search', 'scan', 'quickAdd', 'describe', 'snap', 'water', 'weighIn', 'copyYesterday'] as const;
export type ShortcutId = (typeof SHORTCUT_IDS)[number];

/** Nutrient keys. Energy in kcal, macros in g, minerals/vitamins in the unit given in NUTRIENT_META. */
export const NUTRIENT_KEYS = [
  'kcal',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'sugar',
  'addedSugar',
  'satFat',
  'monoFat',
  'polyFat',
  'transFat',
  'cholesterol',
  'sodium',
  'potassium',
  'calcium',
  'iron',
  'magnesium',
  'zinc',
  'phosphorus',
  'selenium',
  'vitaminA',
  'vitaminC',
  'vitaminD',
  'vitaminE',
  'vitaminK',
  'thiamin',
  'riboflavin',
  'niacin',
  'vitaminB6',
  'folate',
  'vitaminB12',
  'caffeine',
  'alcohol',
] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export type Nutrients = Partial<Record<NutrientKey, number>>;

export interface Serving {
  /** e.g. "1 cup", "1 medium", "1 slice" */
  label: string;
  grams: number;
}

export type FoodSource = 'builtin' | 'custom' | 'recipe' | 'openfoodfacts' | 'usda';

export interface Food {
  id: string;
  name: string;
  brand?: string;
  /** Emoji used as the food icon. */
  icon: string;
  category: string;
  /** Nutrients per 100 g (or 100 ml for liquids, treated as grams). */
  per100: Nutrients;
  /** First entry is the default serving. */
  servings: Serving[];
  source: FoodSource;
  barcode?: string;
  liquid?: boolean;
  aliases?: string[];
  /** Servings have no known weight (e.g. an imported recipe without a total weight): grams are nominal. */
  noWeight?: boolean;
}

export interface RecipeIngredient {
  foodId: string;
  grams: number;
}

export interface Recipe {
  id: string;
  name: string;
  icon: string;
  ingredients: RecipeIngredient[];
  /** Number of servings the recipe makes. */
  servings: number;
  /** Final cooked weight; defaults to the sum of ingredient weights. */
  cookedGrams?: number;
  steps?: string;
  createdAt: number;
}

export interface LogEntry {
  id: string;
  date: string; // YYYY-MM-DD
  /** Minutes after midnight. */
  minute: number;
  name: string;
  icon: string;
  foodId?: string; // undefined for quick-add
  grams?: number;
  /** Display amount, e.g. qty 2 of "1 slice". */
  qty?: number;
  servingLabel?: string;
  /** Absolute nutrients for this entry (snapshot at log time). */
  n: Nutrients;
}

export interface DayMeta {
  date: string;
  /** Excluded from expenditure because the log is incomplete. */
  partial?: boolean;
  /** Empty day counts as an intentional zero-calorie day. */
  fasted?: boolean;
  note?: string;
  waterMl?: number;
}

export interface BodyEntry {
  date: string;
  weight?: number; // in settings weight unit
  bodyFat?: number;
  steps?: number;
  /** Centimetres. */
  measurements?: Partial<Record<MeasurementKey, number>>;
  /** On a period that day (cycle tracking, opt-in). */
  period?: boolean;
}

export interface ProgressPhoto {
  id: string;
  date: string;
  pose: 'front' | 'side' | 'back';
}

export type GoalType = 'lose' | 'maintain' | 'gain';
export type DietType = 'balanced' | 'lowFat' | 'lowCarb' | 'keto';
export type ProteinPref = 'low' | 'moderate' | 'high' | 'extraHigh';
export type CalorieFloor = 'standard' | 'low' | 'none';
export type ProgramStyle = 'coached' | 'manual';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'very';

export interface MacroTarget {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface Goal {
  id: string;
  type: GoalType;
  startDate: string;
  startWeight: number;
  goalWeight?: number;
  /** Percent of body weight per week (positive number; direction from type). */
  ratePct: number;
  style: ProgramStyle;
  diet: DietType;
  protein: ProteinPref;
  floor: CalorieFloor;
  /** Weekdays (0 = Monday) that get extra calories. */
  highDays: number[];
  /** Fraction of weekly calories shifted to high days, 0–0.3. */
  highShift: number;
  checkInDay: number;
  /** Manual program: per-weekday targets. */
  manual?: MacroTarget[];
  endedAt?: string;
}

/** A check-in result; targets apply from `date` until the next snapshot. */
export interface TargetSnapshot {
  date: string;
  goalId: string;
  expenditure: number;
  targets: MacroTarget[]; // 7 entries, Monday first
  reason: string;
  /** Version of the target method that made it (see `TARGET_ALGO`); missing on older snapshots. */
  algo?: number;
}

export interface Profile {
  sex: 'male' | 'female';
  birthYear: number;
  heightCm: number;
  activity: ActivityLevel;
  athlete: boolean;
  bodyFat?: number;
}

export interface Settings {
  weightUnit: WeightUnit;
  energyUnit: EnergyUnit;
  theme: 'system' | 'dark' | 'light';
  accent: string;
  timeline: 'hours' | 'meals';
  meals: { name: string; minute: number }[];
  trendAlpha: number;
  visibleNutrients: NutrientKey[];
  microGoals: Partial<Record<NutrientKey, { floor?: number; target?: number; ceiling?: number }>>;
  waterGoalMl: number;
  onboarded: boolean;
  haptics: boolean;
  reminders: { checkIn: boolean; checkInMinute: number; weighIn: boolean; weighInMinute: number; precise: boolean };
  health: { enabled: boolean; lastSync?: string; writeNutrition: boolean };
  /** AI Assist. The API key is never here: it lives in platform/secrets, one per provider (AD-9). */
  ai: { enabled: boolean; provider: AiProviderId; model: string; baseUrl?: string };
  dashboard: { id: DashboardCardId; visible: boolean }[];
  clock: ClockStyle;
  lengthUnit: LengthUnit;
  /** Robust trend: later weigh-ins revise past trend values to cut lag. Off = past-only smoothing. */
  trendRevise: boolean;
  /** Basis of the 30-day weight projection. */
  projection: 'blend' | 'goal' | 'data';
  shortcuts: ShortcutId[];
  periodTracking: boolean;
  historySort: 'recent' | 'frequent';
}

export type DashboardCardId = 'today' | 'expenditure' | 'trend' | 'goal' | 'insights' | 'week' | 'habits';
