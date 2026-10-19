import type { z } from 'zod/v4';
import { LABEL_SYSTEM, LabelDraftSchema, MEAL_SYSTEM, MealDraftSchema, RECIPE_SYSTEM, RecipeDraftSchema, type LabelDraft, type MealDraft, type RecipeDraft } from '../domain/ai';
import {
  chatRequestBody,
  errorDetail,
  httpErrorMessage,
  isResponseFormatRejection,
  jsonObjectFallback,
  parseJsonText,
  parseModelIds,
  providerPreset,
  readChatResponse,
  resolveBaseUrl,
  structuredFormat,
  type AiConfig,
  type ChatPart,
  type ResponseFormat,
} from '../domain/aiProviders';
import { blobToBase64, downscale } from './camera';
import { fail, ok, type Result } from './native';
import { BlockedHostError, netFetch } from './net';
import { getAiKey } from './secrets';

/**
 * OpenAI-compatible chat completions client (OpenAI, Gemini, OpenRouter, Groq, Mistral, xAI,
 * DeepSeek, custom). Loaded lazily by platform/ai. Every request goes through netFetch to the
 * configured provider host only, with the user's own key (AD-7, AD-9). Results are drafts (AD-8).
 */

const TIMEOUT_MS = 120_000;

interface Conn {
  base: string;
  name: string;
  headers: Record<string, string>;
}

const providerName = (cfg: AiConfig) => (cfg.provider === 'custom' ? 'The AI provider' : providerPreset(cfg.provider).label);

async function connect(cfg: AiConfig): Promise<Result<Conn>> {
  const base = resolveBaseUrl(cfg);
  if (!base) return fail('Enter a valid https base URL in Settings → AI Assist first.');
  const key = await getAiKey(cfg.provider);
  if (!key) return fail('Add your AI key in Settings → AI Assist first.');
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: 'application/json' };
  if (cfg.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/VladDerK1ng/satiago';
    headers['X-Title'] = 'Satiago';
  }
  return ok({ base, name: providerName(cfg), headers });
}

async function send(c: Conn, path: string, body?: unknown): Promise<Result<Response>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await netFetch(`${c.base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? c.headers : { ...c.headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    return ok(res);
  } catch (e) {
    if (e instanceof BlockedHostError) return fail(`${e.message} Check the provider in Settings → AI Assist.`);
    if ((e as Error)?.name === 'AbortError') return fail(`${c.name} took too long to answer. Try again.`);
    return fail(`Couldn't reach ${c.name}. Check your connection.`);
  } finally {
    clearTimeout(timer);
  }
}

async function errorOf(c: Conn, res: Response, withImage = false): Promise<string> {
  const body = await res.text().catch(() => '');
  return httpErrorMessage(res.status, errorDetail(body), c.name, withImage);
}

async function run<T>(cfg: AiConfig, name: string, system: string, parts: ChatPart[], schema: z.ZodType<T>): Promise<Result<T>> {
  const model = cfg.model.trim();
  if (!model) return fail('Choose a model in Settings → AI Assist first.');
  const conn = await connect(cfg);
  if (!conn.ok) return conn;
  const c = conn.value;
  const withImage = parts.some((p) => p.type === 'image_url');
  const post = (sys: string, format: ResponseFormat) => send(c, '/chat/completions', chatRequestBody(model, sys, parts, format));

  let sent = await post(system, structuredFormat(name, schema));
  if (!sent.ok) return sent;
  let res = sent.value;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (!isResponseFormatRejection(res.status, body)) return fail(httpErrorMessage(res.status, errorDetail(body), c.name, withImage));
    // No structured-output support: retry once in JSON mode with the schema in the system prompt.
    const fallback = jsonObjectFallback(system, schema);
    sent = await post(fallback.system, fallback.format);
    if (!sent.ok) return sent;
    res = sent.value;
    if (!res.ok) return fail(await errorOf(c, res, withImage));
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return fail(`${c.name} sent a response that could not be read. Try again.`);
  }
  const reply = readChatResponse(json);
  if (reply.refusal) return fail('The AI declined this request.');
  const parsed = schema.safeParse(parseJsonText(reply.text));
  if (parsed.success) return ok(parsed.data);
  if (reply.finishReason === 'length') return fail('The AI response was cut off. Try a shorter description.');
  if (!reply.text.trim()) return fail('The AI returned an empty answer. Try again or choose another model.');
  return fail("The AI answer didn't match the expected format. Try again or choose another model.");
}

async function imagePart(photo: Blob): Promise<ChatPart> {
  const small = await downscale(photo, 1568, 0.85);
  return { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${await blobToBase64(small)}` } };
}

export async function describeMeal(cfg: AiConfig, text: string): Promise<Result<MealDraft>> {
  return run(cfg, 'meal_draft', MEAL_SYSTEM, [{ type: 'text', text: `Meal description: ${text}` }], MealDraftSchema);
}

export async function snapMeal(cfg: AiConfig, photo: Blob, hint?: string): Promise<Result<MealDraft>> {
  return run(cfg, 'meal_draft', MEAL_SYSTEM, [await imagePart(photo), { type: 'text', text: hint ? `Extra context from the user: ${hint}` : 'Estimate what is on this plate.' }], MealDraftSchema);
}

export async function scanLabel(cfg: AiConfig, photo: Blob): Promise<Result<LabelDraft>> {
  return run(cfg, 'label_draft', LABEL_SYSTEM, [await imagePart(photo), { type: 'text', text: 'Read this nutrition label.' }], LabelDraftSchema);
}

/** Text and photo only: importing from a link needs Anthropic's server-side fetch (see platform/ai). */
export async function importRecipe(cfg: AiConfig, input: { text?: string; photo?: Blob }): Promise<Result<RecipeDraft>> {
  const parts: ChatPart[] = [];
  if (input.photo) parts.push(await imagePart(input.photo));
  if (input.text) parts.push({ type: 'text', text: `Recipe:\n${input.text}` });
  if (!parts.length) return fail('Add recipe text or a photo.');
  return run(cfg, 'recipe_draft', RECIPE_SYSTEM, parts, RecipeDraftSchema);
}

/** Checks the key and the model with a tiny request. */
export async function testKey(cfg: AiConfig): Promise<Result<void>> {
  const model = cfg.model.trim();
  if (!model) return fail('Choose a model first, then test the key.');
  const conn = await connect(cfg);
  if (!conn.ok) return conn;
  const sent = await send(conn.value, '/chat/completions', { model, messages: [{ role: 'user', content: 'Reply with OK.' }] });
  if (!sent.ok) return sent;
  if (!sent.value.ok) return fail(await errorOf(conn.value, sent.value));
  return ok(undefined);
}

/** GET {base}/models with the user's key. */
export async function listModels(cfg: AiConfig): Promise<Result<string[]>> {
  const conn = await connect(cfg);
  if (!conn.ok) return conn;
  const sent = await send(conn.value, '/models');
  if (!sent.ok) return sent;
  if (!sent.value.ok) return fail(await errorOf(conn.value, sent.value));
  let json: unknown;
  try {
    json = await sent.value.json();
  } catch {
    return fail(`${conn.value.name} sent a model list that could not be read. Type a model id instead.`);
  }
  const ids = parseModelIds(json, cfg.provider);
  return ids.length ? ok(ids) : fail(`${conn.value.name} didn't list any models. Type a model id instead.`);
}
