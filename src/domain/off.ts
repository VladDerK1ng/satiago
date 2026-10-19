import type { Food, Nutrients } from './types';

/** Open Food Facts product → Food. Only per-100 g values are used. */
export interface OffProduct {
  code?: string;
  product_name?: string;
  /** Comma-separated string (product API) or array (search service). */
  brands?: string | string[];
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: Record<string, number | string | undefined>;
  categories_tags?: string[];
}

const num = (v: unknown) => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

export function offToFood(p: OffProduct): Food | undefined {
  const n = p.nutriments ?? {};
  const g = (k: string) => num(n[`${k}_100g`]);
  const kcal = g('energy-kcal') ?? (g('energy') !== undefined ? g('energy')! / 4.184 : undefined);
  if (!p.product_name || kcal === undefined) return undefined;
  const per100: Nutrients = { kcal };
  const map: [keyof Nutrients, string, number][] = [
    ['protein', 'proteins', 1],
    ['carbs', 'carbohydrates', 1],
    ['fat', 'fat', 1],
    ['fiber', 'fiber', 1],
    ['sugar', 'sugars', 1],
    ['addedSugar', 'added-sugars', 1],
    ['satFat', 'saturated-fat', 1],
    ['monoFat', 'monounsaturated-fat', 1],
    ['polyFat', 'polyunsaturated-fat', 1],
    ['transFat', 'trans-fat', 1],
    ['cholesterol', 'cholesterol', 1000],
    ['sodium', 'sodium', 1000],
    ['potassium', 'potassium', 1000],
    ['calcium', 'calcium', 1000],
    ['iron', 'iron', 1000],
    ['magnesium', 'magnesium', 1000],
    ['zinc', 'zinc', 1000],
    ['vitaminC', 'vitamin-c', 1000],
    ['vitaminD', 'vitamin-d', 1e6],
    ['vitaminA', 'vitamin-a', 1e6],
    ['caffeine', 'caffeine', 1000],
    ['alcohol', 'alcohol', 0.789], // % vol → g per 100 ml
  ];
  for (const [key, off, f] of map) {
    const v = g(off);
    if (v !== undefined) per100[key] = Math.round(v * f * 100) / 100;
  }
  const servingGrams = num(p.serving_quantity);
  const servings = [
    ...(servingGrams && servingGrams > 0 ? [{ label: p.serving_size?.trim() || '1 serving', grams: servingGrams }] : []),
    { label: '100 g', grams: 100 },
  ];
  return {
    id: `off-${p.code}`,
    name: p.product_name.trim(),
    brand: (Array.isArray(p.brands) ? p.brands[0] : p.brands?.split(',')[0])?.trim() || undefined,
    icon: '🛒',
    category: 'Packaged',
    per100,
    servings,
    source: 'openfoodfacts',
    barcode: p.code,
  };
}

/**
 * Normalize a scanned code to the barcode number Open Food Facts uses. Plain EAN/UPC digits pass
 * through; GS1 Digital Link QR codes (e.g. https://id.gs1.org/01/09506000134352) yield their GTIN,
 * with the padding zero of a GTIN-14 dropped so it matches the EAN-13. Returns undefined otherwise.
 */
export function gtinFromScan(raw: string): string | undefined {
  const s = raw.trim();
  if (/^\d{8,14}$/.test(s)) return s;
  const m = s.match(/\/01\/(\d{14})(?:[/?#]|$)/);
  if (!m) return undefined;
  return m[1].startsWith('0') ? m[1].slice(1) : m[1];
}
