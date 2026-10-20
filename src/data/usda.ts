import { normSearch } from '../domain/nutrition';
import type { Food, NutrientKey, Nutrients } from '../domain/types';
import { FOODS } from './foods';

/**
 * Offline generic foods from USDA FoodData Central (Foundation, SR Legacy and FNDDS; public
 * domain, CC0 1.0). public/data/usda-foods.json is built by scripts/build-usda.mjs and loaded on
 * first use, so it never weighs on app start. Values are per 100 g as USDA publishes them.
 */
export const USDA_ID_PREFIX = 'usda-';

/** [fdcId, name, category, emoji, liquid, nutrients in `keys` order (null = not measured), servings] */
type UsdaRow = [number, string, string, string, 0 | 1, (number | null)[], [string, number][]];
export interface UsdaFile {
  keys: NutrientKey[];
  foods: UsdaRow[];
}

export function decodeUsda(file: UsdaFile): Food[] {
  return file.foods.map(([fdcId, name, category, icon, liquid, values, servings]) => {
    const per100: Nutrients = {};
    values.forEach((v, i) => {
      if (v !== null) per100[file.keys[i]] = v;
    });
    const food: Food = {
      id: `${USDA_ID_PREFIX}${fdcId}`,
      name,
      icon,
      category,
      source: 'usda',
      per100,
      servings: servings.length ? servings.map(([label, grams]) => ({ label, grams })) : [{ label: liquid ? '100 ml' : '100 g', grams: 100 }],
    };
    if (liquid) food.liquid = true;
    return food;
  });
}

let loading: Promise<Food[]> | undefined;
/**
 * Fetches and decodes the database once per session; a failed load is retried on the next call.
 * Foods named exactly like a built-in food are left out, so search shows that food once.
 */
export function loadUsdaFoods(): Promise<Food[]> {
  // The version query gives each release its own service-worker cache entry.
  loading ??= fetch(`data/usda-foods.json?v=${encodeURIComponent((import.meta.env.VITE_APP_VERSION as string | undefined) ?? '')}`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<UsdaFile>;
    })
    .then((file) => {
      const builtin = new Set(FOODS.map((f) => normSearch(f.name)));
      return decodeUsda(file).filter((f) => !builtin.has(normSearch(f.name)));
    })
    .catch((e: unknown) => {
      loading = undefined;
      throw e;
    });
  return loading;
}
