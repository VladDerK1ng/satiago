import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod/v4';
import { LABEL_SYSTEM, LabelDraftSchema, MEAL_SYSTEM, MealDraftSchema, RECIPE_SYSTEM, RecipeDraftSchema, type LabelDraft, type MealDraft, type RecipeDraft } from '../domain/ai';
import { blobToBase64, downscale } from './camera';
import { fail, ok, type Result } from './native';
import { netFetch } from './net';
import { getAiKey } from './secrets';

async function client(): Promise<Anthropic | undefined> {
  const apiKey = await getAiKey('anthropic');
  if (!apiKey) return undefined;
  // The user's own key, sent only to api.anthropic.com through the allow-listed fetch (AD-7, AD-9).
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, fetch: netFetch, maxRetries: 1, timeout: 120_000 });
}

function explain(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Your AI key was rejected. Check it in Settings → AI Assist.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This key cannot use the selected model.';
  if (e instanceof Anthropic.RateLimitError) return 'The AI provider is rate-limiting this key. Try again in a minute.';
  if (e instanceof Anthropic.BadRequestError) return `The AI request was rejected: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach the AI provider. Check your connection.";
  if (e instanceof Anthropic.APIError) return `AI provider error ${e.status ?? ''}: ${e.message}`;
  return (e as Error)?.message ?? 'Unknown AI error.';
}

type ContentBlocks = Anthropic.Beta.BetaContentBlockParam[];

async function run<T>(model: string, system: string, content: ContentBlocks, schema: z.ZodType<T>, tools?: Anthropic.Beta.BetaToolUnion[]): Promise<Result<T>> {
  const c = await client();
  if (!c) return fail('Add your AI key in Settings → AI Assist first.');
  try {
    const res = await c.beta.messages.parse({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content }],
      output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
      // Server-side fallback when the model declines on policy grounds.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      ...(tools ? { tools } : {}),
    });
    if (res.stop_reason === 'refusal') return fail('The AI declined this request.');
    if (res.stop_reason === 'max_tokens') return fail('The AI response was cut off. Try a shorter description.');
    if (!res.parsed_output) return fail('The AI response could not be read. Try again.');
    return ok(res.parsed_output as T);
  } catch (e) {
    return fail(explain(e));
  }
}

async function imageBlock(photo: Blob): Promise<Anthropic.Beta.BetaImageBlockParam> {
  const small = await downscale(photo, 1568, 0.85);
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToBase64(small) } };
}

export async function describeMeal(model: string, text: string): Promise<Result<MealDraft>> {
  return run(model, MEAL_SYSTEM, [{ type: 'text', text: `Meal description: ${text}` }], MealDraftSchema);
}

export async function snapMeal(model: string, photo: Blob, hint?: string): Promise<Result<MealDraft>> {
  return run(model, MEAL_SYSTEM, [await imageBlock(photo), { type: 'text', text: hint ? `Extra context from the user: ${hint}` : 'Estimate what is on this plate.' }], MealDraftSchema);
}

export async function scanLabel(model: string, photo: Blob): Promise<Result<LabelDraft>> {
  return run(model, LABEL_SYSTEM, [await imageBlock(photo), { type: 'text', text: 'Read this nutrition label.' }], LabelDraftSchema);
}

export async function importRecipe(model: string, input: { text?: string; url?: string; photo?: Blob }): Promise<Result<RecipeDraft>> {
  const content: ContentBlocks = [];
  if (input.photo) content.push(await imageBlock(input.photo));
  if (input.url) content.push({ type: 'text', text: `Fetch and read the recipe at this URL: ${input.url}` });
  if (input.text) content.push({ type: 'text', text: `Recipe:\n${input.text}` });
  if (!content.length) return fail('Add recipe text, a photo or a URL.');
  // Web fetch runs on Anthropic's servers, so the app itself only talks to api.anthropic.com.
  const tools = input.url ? [{ type: 'web_fetch_20260209' as const, name: 'web_fetch' as const, max_uses: 2 }] : undefined;
  return run(model, RECIPE_SYSTEM, content, RecipeDraftSchema, tools);
}

export async function testKey(model: string): Promise<Result<void>> {
  const c = await client();
  if (!c) return fail('No key saved.');
  try {
    await c.messages.create({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with OK.' }] });
    return ok(undefined);
  } catch (e) {
    return fail(explain(e));
  }
}
