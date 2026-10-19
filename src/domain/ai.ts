import { z } from 'zod/v4';
import { scale, scoreFood } from './nutrition';
import type { Food, Nutrients } from './types';
import { uid } from './util';

/** AI output schemas (AD-8). All fields required; unknown values come back as null. */
const per100 = z.object({
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  fiber: z.number().nullable(),
  sugar: z.number().nullable(),
  satFat: z.number().nullable(),
  sodium: z.number().nullable().describe('mg per 100 g'),
});

export const MealDraftSchema = z.object({
  items: z.array(
    z.object({
      name: z.string().describe('Generic food name, e.g. "Scrambled eggs" or "Latte, 2% milk"'),
      portion: z.string().describe('Human-readable portion, e.g. "2 large eggs" or "1 medium cup"'),
      grams: z.number().describe('Estimated edible weight in grams (ml for drinks)'),
      confidence: z.enum(['high', 'medium', 'low']),
      per100,
    }),
  ),
  note: z.string().nullable().describe('One short sentence about assumptions, or null'),
});
export type MealDraft = z.infer<typeof MealDraftSchema>;

export const LabelDraftSchema = z.object({
  name: z.string(),
  brand: z.string().nullable(),
  servingLabel: z.string().describe('Serving description from the label, e.g. "1 bar" or "2/3 cup"'),
  servingGrams: z.number().describe('Serving size in grams (or ml)'),
  liquid: z.boolean(),
  perServing: z.object({
    kcal: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
    fiber: z.number().nullable(),
    sugar: z.number().nullable(),
    addedSugar: z.number().nullable(),
    satFat: z.number().nullable(),
    transFat: z.number().nullable(),
    cholesterol: z.number().nullable().describe('mg'),
    sodium: z.number().nullable().describe('mg'),
    potassium: z.number().nullable().describe('mg'),
    calcium: z.number().nullable().describe('mg'),
    iron: z.number().nullable().describe('mg'),
    vitaminD: z.number().nullable().describe('mcg'),
  }),
});
export type LabelDraft = z.infer<typeof LabelDraftSchema>;

export const RecipeDraftSchema = z.object({
  name: z.string(),
  servings: z.number(),
  ingredients: z.array(
    z.object({
      name: z.string().describe('Generic ingredient name, raw/uncooked unless the recipe says otherwise'),
      grams: z.number(),
      per100,
    }),
  ),
  steps: z.string().nullable(),
});
export type RecipeDraft = z.infer<typeof RecipeDraftSchema>;

const clean = (n: Record<string, number | null>): Nutrients => {
  const out: Nutrients = {};
  for (const [k, v] of Object.entries(n)) if (v !== null && Number.isFinite(v) && v >= 0) out[k as keyof Nutrients] = v;
  return out;
};

export interface MatchedItem {
  id: string;
  name: string;
  portion: string;
  grams: number;
  confidence: 'high' | 'medium' | 'low' | 'database';
  food: Food;
  /** True when the item maps to an existing Food rather than an AI estimate. */
  matched: boolean;
}

/** Prefer an existing Food when the name matches well; otherwise build an estimate Food. */
export function matchItem(name: string, grams: number, per: Record<string, number | null>, foods: Food[], portion = '', confidence: MatchedItem['confidence'] = 'medium'): MatchedItem {
  let best: Food | undefined;
  let bestScore = 0;
  for (const f of foods) {
    const s = scoreFood(f, name);
    if (s > bestScore) {
      bestScore = s;
      best = f;
    }
  }
  const words = name.trim().split(/\s+/).length;
  const strong = best && bestScore >= Math.max(24, words * 12);
  const food: Food =
    strong && best
      ? best
      : {
          id: `ai-${uid()}`,
          name,
          icon: '✨',
          category: 'AI estimate',
          per100: clean(per),
          servings: [{ label: portion || `${Math.round(grams)} g`, grams }],
          source: 'custom',
        };
  return { id: uid(), name: food.name, portion, grams, confidence: strong ? 'database' : confidence, food, matched: !!strong };
}

export const matchMeal = (d: MealDraft, foods: Food[]) => d.items.map((i) => matchItem(i.name, i.grams, i.per100, foods, i.portion, i.confidence));

export function labelToFood(d: LabelDraft, barcode?: string): Food {
  const grams = d.servingGrams > 0 ? d.servingGrams : 100;
  return {
    id: `custom-${uid()}`,
    name: d.name,
    brand: d.brand ?? undefined,
    icon: d.liquid ? '🥤' : '🍽',
    category: 'Packaged',
    per100: scale(clean(d.perServing), (100 * 100) / grams),
    servings: [{ label: d.servingLabel || '1 serving', grams }],
    source: 'custom',
    liquid: d.liquid,
    barcode,
  };
}

export const MEAL_SYSTEM =
  'You are a nutrition estimator inside a food-logging app. Identify each distinct food or drink and estimate the eaten portion in grams (ml for drinks). ' +
  'Give typical per-100 g nutrition for that food as prepared. Split mixed plates into components when that is how people would log them; keep composite dishes (e.g. lasagna) whole. ' +
  'Use generic names that match common food databases. Mark confidence low when the portion or item is guesswork. Never invent foods that are not described or visible.';

export const LABEL_SYSTEM =
  'You read nutrition facts labels from photos. Copy the per-serving values exactly as printed. Convert sodium, cholesterol, potassium, calcium and iron to mg, vitamin D to mcg. ' +
  'If the label only shows per-100 g values, set servingGrams to 100 and servingLabel to "100 g". Use null for values not printed.';

export const RECIPE_SYSTEM =
  'You turn recipes into ingredient lists for a nutrition app. List every ingredient with its weight in grams (convert cups, spoons and pieces using typical weights) and typical per-100 g nutrition for the raw ingredient. ' +
  'Use the servings count the recipe states (or a sensible estimate). Put concise numbered steps in steps, or null.';
