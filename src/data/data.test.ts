import { describe, expect, it } from 'vitest';
import { FOODS } from './foods';
import { gtinFromScan, offToFood } from '../domain/off';
import { kcalFromMacros, scoreFood } from '../domain/nutrition';

describe('food database', () => {
  it('has unique ids, servings and core nutrients', () => {
    expect(FOODS.length).toBeGreaterThan(200);
    expect(new Set(FOODS.map((f) => f.id)).size).toBe(FOODS.length);
    for (const f of FOODS) {
      expect(f.servings.length, f.id).toBeGreaterThan(0);
      for (const k of ['kcal', 'protein', 'carbs', 'fat'] as const) expect(f.per100[k], `${f.id}.${k}`).toBeTypeOf('number');
    }
  });
  // Very low-energy produce uses food-specific Atwater factors, so general 4/4/9 overestimates it.
  it('energy roughly matches macros', () => {
    const bad = FOODS.filter((f) => {
      const p = f.per100;
      const est = kcalFromMacros(p.protein!, p.carbs!, p.fat!, p.alcohol ?? 0);
      return p.kcal! >= 60 && Math.abs(est - p.kcal!) / p.kcal! > 0.2;
    }).map((f) => f.id);
    expect(bad).toEqual([]);
  });
  it('search finds staples first', () => {
    const top = (q: string) =>
      FOODS.map((f) => ({ f, s: scoreFood(f, q) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)[0]?.f.name.toLowerCase();
    expect(top('banana')).toContain('banana');
    expect(top('chicken breast')).toContain('chicken breast');
    expect(top('oats')).toContain('oat');
  });
});

describe('open food facts mapping', () => {
  it('converts per-100 g nutriments and units', () => {
    const f = offToFood({
      code: '123',
      product_name: 'Test Bar',
      brands: 'Acme, Other',
      serving_size: '1 bar (40 g)',
      serving_quantity: '40',
      nutriments: { 'energy-kcal_100g': 400, proteins_100g: 20, carbohydrates_100g: 40, fat_100g: 16, sodium_100g: 0.3, 'vitamin-d_100g': 0.000005 },
    });
    expect(f?.id).toBe('off-123');
    expect(f?.brand).toBe('Acme');
    expect(f?.per100.sodium).toBe(300);
    expect(f?.per100.vitaminD).toBe(5);
    expect(f?.servings[0]).toEqual({ label: '1 bar (40 g)', grams: 40 });
  });
  it('rejects products without energy', () => {
    expect(offToFood({ code: '1', product_name: 'X', nutriments: {} })).toBeUndefined();
  });
});

describe('scanned code normalization', () => {
  it('passes EAN/UPC digits and reads GS1 Digital Link QR codes', () => {
    expect(gtinFromScan('3017620422003')).toBe('3017620422003');
    expect(gtinFromScan(' 012345678905 ')).toBe('012345678905');
    expect(gtinFromScan('https://id.gs1.org/01/03017620422003/10/ABC')).toBe('3017620422003');
    expect(gtinFromScan('https://example.com/01/19506000134352?x=1')).toBe('19506000134352');
    expect(gtinFromScan('https://example.com/menu')).toBeUndefined();
  });
  it('accepts brands as an array from the search service', () => {
    const f = offToFood({ code: '1', product_name: 'Yogurt', brands: ['Chobani', 'Other'], nutriments: { 'energy-kcal_100g': 53 } });
    expect(f?.brand).toBe('Chobani');
  });
});
