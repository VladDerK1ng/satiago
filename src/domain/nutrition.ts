import type { Food, LogEntry, Nutrients, NutrientKey, Recipe } from './types';
import { NUTRIENT_KEYS } from './types';

export interface NutrientMeta {
  label: string;
  unit: 'kcal' | 'g' | 'mg' | 'mcg';
  group: 'Energy' | 'Macros' | 'Carbs' | 'Fats' | 'Minerals' | 'Vitamins' | 'Other';
  /** Reference daily target for adults (approximate RDA/AI or common guidance). */
  target?: number;
  /** Upper level to stay under (for limits such as sodium, sat fat). */
  ceiling?: number;
}

export const NUTRIENT_META: Record<NutrientKey, NutrientMeta> = {
  kcal: { label: 'Energy', unit: 'kcal', group: 'Energy' },
  protein: { label: 'Protein', unit: 'g', group: 'Macros' },
  carbs: { label: 'Carbs', unit: 'g', group: 'Macros' },
  fat: { label: 'Fat', unit: 'g', group: 'Macros' },
  fiber: { label: 'Fiber', unit: 'g', group: 'Carbs', target: 30 },
  sugar: { label: 'Sugars', unit: 'g', group: 'Carbs' },
  addedSugar: { label: 'Added sugars', unit: 'g', group: 'Carbs', ceiling: 50 },
  satFat: { label: 'Saturated fat', unit: 'g', group: 'Fats', ceiling: 22 },
  monoFat: { label: 'Monounsaturated fat', unit: 'g', group: 'Fats' },
  polyFat: { label: 'Polyunsaturated fat', unit: 'g', group: 'Fats' },
  transFat: { label: 'Trans fat', unit: 'g', group: 'Fats', ceiling: 2 },
  cholesterol: { label: 'Cholesterol', unit: 'mg', group: 'Fats', ceiling: 300 },
  sodium: { label: 'Sodium', unit: 'mg', group: 'Minerals', target: 1500, ceiling: 2300 },
  potassium: { label: 'Potassium', unit: 'mg', group: 'Minerals', target: 3400 },
  calcium: { label: 'Calcium', unit: 'mg', group: 'Minerals', target: 1000, ceiling: 2500 },
  iron: { label: 'Iron', unit: 'mg', group: 'Minerals', target: 8, ceiling: 45 },
  magnesium: { label: 'Magnesium', unit: 'mg', group: 'Minerals', target: 400 },
  zinc: { label: 'Zinc', unit: 'mg', group: 'Minerals', target: 11, ceiling: 40 },
  phosphorus: { label: 'Phosphorus', unit: 'mg', group: 'Minerals', target: 700 },
  selenium: { label: 'Selenium', unit: 'mcg', group: 'Minerals', target: 55, ceiling: 400 },
  vitaminA: { label: 'Vitamin A', unit: 'mcg', group: 'Vitamins', target: 900, ceiling: 3000 },
  vitaminC: { label: 'Vitamin C', unit: 'mg', group: 'Vitamins', target: 90, ceiling: 2000 },
  vitaminD: { label: 'Vitamin D', unit: 'mcg', group: 'Vitamins', target: 15, ceiling: 100 },
  vitaminE: { label: 'Vitamin E', unit: 'mg', group: 'Vitamins', target: 15 },
  vitaminK: { label: 'Vitamin K', unit: 'mcg', group: 'Vitamins', target: 120 },
  thiamin: { label: 'Thiamin (B1)', unit: 'mg', group: 'Vitamins', target: 1.2 },
  riboflavin: { label: 'Riboflavin (B2)', unit: 'mg', group: 'Vitamins', target: 1.3 },
  niacin: { label: 'Niacin (B3)', unit: 'mg', group: 'Vitamins', target: 16 },
  vitaminB6: { label: 'Vitamin B6', unit: 'mg', group: 'Vitamins', target: 1.3 },
  folate: { label: 'Folate', unit: 'mcg', group: 'Vitamins', target: 400 },
  vitaminB12: { label: 'Vitamin B12', unit: 'mcg', group: 'Vitamins', target: 2.4 },
  caffeine: { label: 'Caffeine', unit: 'mg', group: 'Other', ceiling: 400 },
  alcohol: { label: 'Alcohol', unit: 'g', group: 'Other' },
};

export const MICROS: NutrientKey[] = NUTRIENT_KEYS.filter((k) => !['kcal', 'protein', 'carbs', 'fat'].includes(k));

export function scale(per100: Nutrients, grams: number): Nutrients {
  const out: Nutrients = {};
  const f = grams / 100;
  for (const k of NUTRIENT_KEYS) {
    const v = per100[k];
    if (v !== undefined) out[k] = v * f;
  }
  return out;
}

export function sum(list: Nutrients[]): Nutrients {
  const out: Nutrients = {};
  for (const n of list) {
    for (const k of NUTRIENT_KEYS) {
      const v = n[k];
      if (v !== undefined) out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

export const kcalFromMacros = (p: number, c: number, f: number, alcohol = 0) => p * 4 + c * 4 + f * 9 + alcohol * 7;

/** Turn a recipe into a food with per-100 g nutrients. Unknown ingredients are skipped. */
export function recipeToFood(r: Recipe, lookup: (id: string) => Food | undefined): Food {
  const parts = r.ingredients
    .map((i) => {
      const f = lookup(i.foodId);
      return f ? scale(f.per100, i.grams) : undefined;
    })
    .filter((x): x is Nutrients => !!x);
  const total = sum(parts);
  const rawGrams = r.ingredients.reduce((t, i) => t + i.grams, 0);
  const grams = r.cookedGrams && r.cookedGrams > 0 ? r.cookedGrams : rawGrams;
  const per100 = grams > 0 ? scale(total, (100 * 100) / grams) : {};
  const servingGrams = grams / Math.max(1, r.servings);
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    category: 'Recipes',
    per100,
    servings: [
      { label: '1 serving', grams: Math.round(servingGrams * 10) / 10 },
      { label: 'whole recipe', grams: Math.round(grams) },
    ],
    source: 'recipe',
  };
}

export function dayTotals(entries: LogEntry[]): Nutrients {
  return sum(entries.map((e) => e.n));
}

export const KJ_PER_KCAL = 4.184;
export const fmtEnergy = (kcal: number | undefined, unit: 'kcal' | 'kJ') =>
  kcal === undefined ? '–' : unit === 'kJ' ? `${Math.round(kcal * KJ_PER_KCAL)}` : `${Math.round(kcal)}`;

type Searchable = Pick<Food, 'name' | 'brand' | 'aliases' | 'category'>;

/** Search text: accents are dropped ("Ovăz" matches "ovaz"); letters of any script are kept. */
export const normSearch = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

interface SearchKey {
  name: string;
  hay: string;
}
const searchKeys = new WeakMap<Searchable, SearchKey>();
/** Normalized name and haystack of a food, computed once per food object. */
function searchKey(f: Searchable): SearchKey {
  let k = searchKeys.get(f);
  if (!k) {
    const name = normSearch(f.name);
    k = { name, hay: [name, normSearch(f.brand ?? ''), ...(f.aliases ?? []).map(normSearch), normSearch(f.category)].join(' ') };
    searchKeys.set(f, k);
  }
  return k;
}

/** Search score for foods; 0 means no match. Pass `normalized` when the query is already normSearch'ed. */
export function scoreFood(f: Searchable, q: string, normalized = false): number {
  const query = normalized ? q : normSearch(q);
  if (!query) return 1;
  const { name, hay } = searchKey(f);
  if (name === query) return 100;
  if (name.startsWith(query)) return 70 - name.length / 100;
  let s = 0;
  for (const t of query.split(' ')) {
    const stem = t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t;
    if (hay.includes(stem)) s += name.includes(stem) ? 12 : 6;
    else return 0;
  }
  return s - name.length / 100;
}

/** Id prefix of a food rebuilt from a log entry; never stored, never a real food id. */
export const ENTRY_FOOD_PREFIX = 'entry:';

/**
 * A food rebuilt from a log entry's own nutrient snapshot (AD-5), so any entry can change its
 * amount even when no food backs it (imports, AI estimates, foods deleted later). Returns
 * undefined for quick adds, which have neither a weight nor a serving to scale.
 * `weighed` is false when the entry has no gram weight: its servings are then the only units.
 */
export function foodFromEntry(e: LogEntry): { food: Food; weighed: boolean } | undefined {
  const label = e.servingLabel?.trim();
  const qty = e.qty && e.qty > 0 ? e.qty : 1;
  const byWeight = !label || /^(g|ml|oz)$/i.test(label);
  // A weight unit as the serving label is the weight itself (15 x g = 15 g); stored grams can be wrong
  // in entries imported before v4, so the quantity wins.
  const grams = label && byWeight ? qty * (/^oz$/i.test(label) ? 28.3495 : 1) : e.grams && e.grams > 0 ? e.grams : undefined;
  if (!grams && !label) return undefined;
  // Without a weight, one serving is priced as a nominal 100 g so the per-100 maths still holds.
  const total = grams ?? 100 * qty;
  return {
    weighed: !!grams,
    food: {
      id: ENTRY_FOOD_PREFIX + e.id,
      name: e.name,
      icon: e.icon,
      category: 'Logged',
      per100: scale(e.n, (100 * 100) / total),
      servings: byWeight ? [] : [{ label: label!, grams: total / qty }],
      source: 'custom',
      liquid: /^ml$/i.test(label ?? '') || undefined,
    },
  };
}
