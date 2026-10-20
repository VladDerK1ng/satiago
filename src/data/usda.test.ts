import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { kcalFromMacros, normSearch, scoreFood } from '../domain/nutrition';
import { NUTRIENT_KEYS } from '../domain/types';
import { FOODS } from './foods';
import { decodeUsda, loadUsdaFoods, type UsdaFile } from './usda';

const file = JSON.parse(readFileSync(new URL('../../public/data/usda-foods.json', import.meta.url), 'utf8')) as UsdaFile;
const USDA = decodeUsda(file);
// The categories the food editor offers; USDA foods never use "Packaged".
const CATEGORIES = ['Fruits', 'Vegetables', 'Grains', 'Legumes', 'Nuts & Seeds', 'Dairy & Eggs', 'Meat', 'Seafood', 'Plant Protein', 'Fats & Oils', 'Condiments', 'Snacks & Sweets', 'Beverages', 'Prepared', 'Supplements'];

const top = (q: string, n = 1) =>
  [...FOODS, ...USDA]
    .map((f) => ({ f, s: scoreFood(f, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.f);

describe('offline USDA database', () => {
  it('decodes rows, units and a fallback serving', () => {
    const [solid, drink] = decodeUsda({
      keys: ['kcal', 'protein', 'carbs', 'fat', 'fiber'],
      foods: [
        [1, 'Oats', 'Grains', '🥣', 0, [379, 13.2, 67.7, 6.5, null], [['1 cup', 81]]],
        [2, 'Milk, whole', 'Dairy & Eggs', '🥛', 1, [61, 3.3, 4.6, 3.3], []],
      ],
    });
    expect(solid).toMatchObject({ id: 'usda-1', source: 'usda', per100: { kcal: 379, fat: 6.5 }, servings: [{ label: '1 cup', grams: 81 }] });
    expect(solid.per100).not.toHaveProperty('fiber');
    expect(solid.liquid).toBeUndefined();
    expect(drink).toMatchObject({ liquid: true, servings: [{ label: '100 ml', grams: 100 }] });
  });

  it('has thousands of foods with unique ids, known categories and servings', () => {
    expect(file.keys).toEqual([...NUTRIENT_KEYS]);
    expect(USDA.length).toBeGreaterThan(12000);
    const ids = new Set(USDA.map((f) => f.id));
    expect(ids.size).toBe(USDA.length);
    for (const f of FOODS) expect(ids.has(f.id)).toBe(false);
    for (const f of USDA) {
      expect(CATEGORIES, f.id).toContain(f.category);
      expect(f.icon, f.id).toBeTruthy();
      expect(f.servings.length, f.id).toBeGreaterThan(0);
      for (const s of f.servings) expect(s.grams, `${f.id} ${s.label}`).toBeGreaterThan(0);
      for (const k of ['kcal', 'protein', 'carbs', 'fat'] as const) expect(f.per100[k], `${f.id}.${k}`).toBeGreaterThanOrEqual(0);
    }
  });

  // USDA uses food-specific Atwater factors, so a few foods (fibre-rich, sugar alcohols) differ from 4/4/9.
  it('energy matches macros for nearly every food', () => {
    const off = USDA.filter((f) => {
      const p = f.per100;
      const est = kcalFromMacros(p.protein!, p.carbs!, p.fat!, p.alcohol ?? 0);
      return p.kcal! >= 60 && Math.abs(est - p.kcal!) / p.kcal! > 0.2;
    });
    expect(off.length / USDA.length).toBeLessThan(0.01);
  });

  it('loads once and leaves out foods named like a built-in food', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(file)));
    vi.stubGlobal('fetch', fetch);
    try {
      const loaded = await loadUsdaFoods();
      expect(await loadUsdaFoods()).toBe(loaded);
      expect(fetch).toHaveBeenCalledTimes(1);
      const builtin = new Set(FOODS.map((f) => normSearch(f.name)));
      expect(USDA.some((f) => builtin.has(normSearch(f.name)))).toBe(true);
      expect(loaded.some((f) => builtin.has(normSearch(f.name)))).toBe(false);
      expect(loaded.length).toBeGreaterThan(12000);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('finds generic foods the built-in list lacks, after the built-in staples', () => {
    expect(top('banana')[0].source).toBe('builtin');
    expect(top('quinoa cooked', 5).some((f) => f.name.toLowerCase().includes('quinoa'))).toBe(true);
    expect(top('kohlrabi', 3).every((f) => f.source === 'usda' && /kohlrabi/i.test(f.name))).toBe(true);
    expect(top('duck', 5).some((f) => f.source === 'usda' && f.icon === '🍗')).toBe(true);
  });

  it('marks drinks as liquids but not their powders', () => {
    const named = (re: RegExp) => USDA.filter((f) => re.test(f.name));
    expect(named(/^Milk, whole, 3\.25% milkfat, with added vitamin D$/)[0]?.liquid).toBe(true);
    expect(named(/^Beverages, Orange juice drink$/)[0]?.liquid).toBe(true);
    expect(named(/^Milk, dry, whole/).every((f) => !f.liquid)).toBe(true);
    expect(named(/^Beverages, coffee, instant, regular, powder$/).every((f) => !f.liquid)).toBe(true);
  });
});
