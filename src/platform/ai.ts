import type { LabelDraft, MealDraft, RecipeDraft } from '../domain/ai';
import { ANTHROPIC_MODELS, supportsUrlImport, type AiConfig } from '../domain/aiProviders';
import { fail, ok, type Result } from './native';

export type { AiConfig };

// Each client loads only when an AI feature is first used: the Anthropic SDK for 'anthropic',
// a small fetch-based client for every OpenAI-compatible provider.
const anthropic = () => import('./aiImpl');
const compatible = () => import('./aiOpenAi');
const isAnthropic = (cfg: AiConfig) => cfg.provider === 'anthropic';

export const describeMeal = async (cfg: AiConfig, text: string): Promise<Result<MealDraft>> =>
  isAnthropic(cfg) ? (await anthropic()).describeMeal(cfg.model.trim(), text) : (await compatible()).describeMeal(cfg, text);

export const snapMeal = async (cfg: AiConfig, photo: Blob, hint?: string): Promise<Result<MealDraft>> =>
  isAnthropic(cfg) ? (await anthropic()).snapMeal(cfg.model.trim(), photo, hint) : (await compatible()).snapMeal(cfg, photo, hint);

export const scanLabel = async (cfg: AiConfig, photo: Blob): Promise<Result<LabelDraft>> =>
  isAnthropic(cfg) ? (await anthropic()).scanLabel(cfg.model.trim(), photo) : (await compatible()).scanLabel(cfg, photo);

export async function importRecipe(cfg: AiConfig, input: { text?: string; url?: string; photo?: Blob }): Promise<Result<RecipeDraft>> {
  if (isAnthropic(cfg)) return (await anthropic()).importRecipe(cfg.model.trim(), input);
  // Link import uses Anthropic's server-side web fetch, so the app never fetches recipe sites itself.
  if (input.url && !supportsUrlImport(cfg.provider)) return fail('Importing from a link needs Anthropic as the AI provider. Paste the recipe text or use a photo instead.');
  return (await compatible()).importRecipe(cfg, { text: input.text, photo: input.photo });
}

export const testKey = async (cfg: AiConfig): Promise<Result<void>> =>
  isAnthropic(cfg) ? (await anthropic()).testKey(cfg.model.trim()) : (await compatible()).testKey(cfg);

/** Models to choose from: Anthropic's suggested list, or GET {base}/models for other providers. */
export const listModels = async (cfg: AiConfig): Promise<Result<string[]>> =>
  isAnthropic(cfg) ? ok(ANTHROPIC_MODELS.map((m) => m.id)) : (await compatible()).listModels(cfg);
