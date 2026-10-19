import { z } from 'zod/v4';

/**
 * AI providers for AI Assist (FR-42–FR-46). Pure presets and request/response helpers (AD-1);
 * the network calls live in src/platform/aiImpl.ts (Anthropic) and src/platform/aiOpenAi.ts.
 */
export const AI_PROVIDER_IDS = ['anthropic', 'openai', 'google', 'openrouter', 'groq', 'mistral', 'xai', 'deepseek', 'custom'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** Which client talks to the provider. */
export type AiApi = 'anthropic' | 'openai-compatible';

export interface AiModelOption {
  id: string;
  label: string;
}

export interface AiProviderPreset {
  id: AiProviderId;
  /** Brand name shown in Settings (the custom provider's label comes from i18n). */
  label: string;
  api: AiApi;
  /** API base URL; empty for 'custom', where the user enters an https URL. */
  baseUrl: string;
  /** Suggested models. Only Anthropic ships a list; the others load theirs from GET {base}/models. */
  models: readonly AiModelOption[];
}

/** The settings slice that selects the provider and model for every AI request. */
export interface AiConfig {
  provider: AiProviderId;
  model: string;
  /** Only used by the 'custom' provider. */
  baseUrl?: string;
}

export const ANTHROPIC_MODELS: readonly AiModelOption[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cheapest)' },
];
export const DEFAULT_AI_PROVIDER: AiProviderId = 'anthropic';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

const compatible = (id: AiProviderId, label: string, baseUrl: string): AiProviderPreset => ({ id, label, api: 'openai-compatible', baseUrl, models: [] });

export const AI_PROVIDERS: readonly AiProviderPreset[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', api: 'anthropic', baseUrl: 'https://api.anthropic.com', models: ANTHROPIC_MODELS },
  compatible('openai', 'OpenAI', 'https://api.openai.com/v1'),
  compatible('google', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'),
  compatible('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1'),
  compatible('groq', 'Groq', 'https://api.groq.com/openai/v1'),
  compatible('mistral', 'Mistral AI', 'https://api.mistral.ai/v1'),
  compatible('xai', 'xAI (Grok)', 'https://api.x.ai/v1'),
  compatible('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1'),
  compatible('custom', 'Custom provider', ''),
];

/** Hosts of the built-in presets, for the About screen and privacy notes. */
export const PRESET_AI_HOSTS: readonly string[] = AI_PROVIDERS.filter((p) => p.baseUrl).map((p) => new URL(p.baseUrl).host);

export const isAiProviderId = (v: unknown): v is AiProviderId => typeof v === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(v);

export const providerPreset = (id: AiProviderId): AiProviderPreset => AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];

/**
 * Recipe import from a link relies on Anthropic's server-side web fetch, so the app itself never
 * fetches recipe sites. Other providers import from text and photos only.
 */
export const supportsUrlImport = (provider: AiProviderId) => provider === 'anthropic';

/** Model preselected when the user switches to a provider. Other providers start empty until models load. */
export const defaultModelFor = (provider: AiProviderId) => (provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : '');

export type BaseUrlProblem = 'empty' | 'invalid' | 'insecure' | 'credentials' | 'query';

/** Validates a custom base URL: https only, no credentials, query or fragment. Returns it without a trailing slash. */
export function checkBaseUrl(raw: string): { ok: true; value: string } | { ok: false; problem: BaseUrlProblem } {
  const s = raw.trim();
  if (!s) return { ok: false, problem: 'empty' };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, problem: 'invalid' };
  }
  if (u.protocol === 'http:') return { ok: false, problem: 'insecure' };
  if (u.protocol !== 'https:' || !u.hostname) return { ok: false, problem: 'invalid' };
  if (u.username || u.password) return { ok: false, problem: 'credentials' };
  if (u.search || u.hash) return { ok: false, problem: 'query' };
  return { ok: true, value: `${u.origin}${u.pathname.replace(/\/+$/, '')}` };
}

/** The base URL AI requests go to, or undefined while a custom provider has no valid one. */
export function resolveBaseUrl(cfg: Pick<AiConfig, 'provider' | 'baseUrl'>): string | undefined {
  if (cfg.provider !== 'custom') return providerPreset(cfg.provider).baseUrl;
  const r = checkBaseUrl(cfg.baseUrl ?? '');
  return r.ok ? r.value : undefined;
}

/** The one host AI requests may reach (AD-7), e.g. "api.openai.com". */
export function aiHostFor(cfg: Pick<AiConfig, 'provider' | 'baseUrl'>): string | undefined {
  const base = resolveBaseUrl(cfg);
  return base ? new URL(base).host : undefined;
}

/** Repairs a persisted or restored `settings.ai` value; data from before providers existed is Anthropic. */
export function normalizeAiSettings(raw: unknown): AiConfig & { enabled: boolean } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const provider = isAiProviderId(r.provider) ? r.provider : DEFAULT_AI_PROVIDER;
  const out: AiConfig & { enabled: boolean } = {
    enabled: r.enabled === true,
    provider,
    model: typeof r.model === 'string' ? r.model : defaultModelFor(provider),
  };
  if (typeof r.baseUrl === 'string' && r.baseUrl) out.baseUrl = r.baseUrl;
  return out;
}

// ---------------------------------------------------------------------------------------------
// OpenAI-compatible chat completions (used by every provider except Anthropic)
// ---------------------------------------------------------------------------------------------

export type ChatPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export type ResponseFormat = { type: 'json_schema'; json_schema: { name: string; schema: Record<string, unknown>; strict: true } } | { type: 'json_object' };

/** JSON Schema for a zod schema in the shape structured outputs expect (no `$schema` key). */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const out = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete out.$schema;
  return out;
}

export function structuredFormat(name: string, schema: z.ZodType): ResponseFormat {
  return { type: 'json_schema', json_schema: { name, schema: jsonSchemaFor(schema), strict: true } };
}

/** Fallback for servers without json_schema support: JSON mode with the schema in the system prompt. */
export function jsonObjectFallback(system: string, schema: z.ZodType): { system: string; format: ResponseFormat } {
  return {
    system: `${system}\n\nReply with only a JSON object (no prose, no code fences) that matches this JSON Schema:\n${JSON.stringify(jsonSchemaFor(schema))}`,
    format: { type: 'json_object' },
  };
}

/** Request body for POST {base}/chat/completions. Text-only prompts are sent as a plain string for wider compatibility. */
export function chatRequestBody(model: string, system: string, parts: ChatPart[], format?: ResponseFormat) {
  const textOnly = parts.every((p) => p.type === 'text');
  const content = textOnly ? parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n\n') : parts;
  return {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content },
    ],
    ...(format ? { response_format: format } : {}),
  };
}

/** True when the server rejected structured outputs, so the request should be retried in JSON mode. */
export const isResponseFormatRejection = (status: number, body: string) =>
  (status === 400 || status === 422) && /response[_ ]?format|json[_ ]?schema|structured[_ ]?output/i.test(body);

/** The human-readable message inside an error body (OpenAI, Google, Mistral and OpenRouter shapes). */
export function errorDetail(body: string): string {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return body.trim().slice(0, 300);
  }
  const pick = (v: unknown, depth = 0): string | undefined => {
    if (depth > 4) return undefined;
    if (typeof v === 'string') return v.trim() || undefined;
    if (Array.isArray(v)) return pick(v[0], depth + 1);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return pick(o.error, depth + 1) ?? pick(o.message, depth + 1) ?? pick(o.detail, depth + 1) ?? pick(o.msg, depth + 1);
    }
    return undefined;
  };
  return (pick(json) ?? body).trim().slice(0, 300);
}

const VISION_HINT = /image|vision|multimodal|modalit/i;

/** Friendly message for an HTTP error from an OpenAI-compatible provider. */
export function httpErrorMessage(status: number, detail: string, provider: string, withImage = false): string {
  const d = detail ? `: ${detail}` : '.';
  if (status === 401) return `${provider} rejected your API key. Check it in Settings → AI Assist.`;
  if (status === 403) return `${provider} doesn't allow this key to use the selected model${d}`;
  if (status === 429) return `${provider} is rate-limiting this key, or the account is out of credit. Try again in a minute${d}`;
  if (status >= 500) return `${provider} had a server problem (${status}). Try again later.`;
  if (withImage && VISION_HINT.test(detail)) return `The selected model can't read photos${d}. Choose a model with vision in Settings → AI Assist.`;
  if (status === 404) return `${provider} couldn't find this model or endpoint. Check the model id in Settings → AI Assist${d}`;
  return `${provider} rejected the request (${status})${d}`;
}

export interface ChatReply {
  text: string;
  finishReason?: string;
  refusal?: string;
}

/** Reads the first choice of a chat completion response. */
export function readChatResponse(json: unknown): ChatReply {
  const choices = (json as { choices?: unknown } | null)?.choices;
  const choice = (Array.isArray(choices) ? choices[0] : undefined) as { finish_reason?: unknown; message?: { content?: unknown; refusal?: unknown } } | undefined;
  const content = choice?.message?.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((p) => (p && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')).join('')
        : '';
  const refusal = choice?.message?.refusal;
  return {
    text,
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
    refusal: typeof refusal === 'string' && refusal.trim() ? refusal : undefined,
  };
}

/** Parses model output as JSON, tolerating code fences and text around the object. Undefined when it isn't JSON. */
export function parseJsonText(text: string): unknown {
  const s = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  const body = fenced ? fenced[1] : s;
  try {
    return JSON.parse(body);
  } catch {
    // Try the outermost object below.
  }
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(body.slice(a, b + 1));
    } catch {
      // Not JSON.
    }
  }
  return undefined;
}

/** Model ids from GET {base}/models (`{ data: [{ id }] }`, or `{ models: [...] }`), sorted and de-duplicated. */
export function parseModelIds(json: unknown, provider: AiProviderId): string[] {
  const o = (json && typeof json === 'object' ? json : {}) as { data?: unknown; models?: unknown };
  const list: unknown[] = Array.isArray(json) ? json : Array.isArray(o.data) ? o.data : Array.isArray(o.models) ? o.models : [];
  const ids = list
    .map((m) => {
      if (typeof m === 'string') return m;
      if (m && typeof m === 'object') {
        const r = m as { id?: unknown; name?: unknown };
        return typeof r.id === 'string' ? r.id : typeof r.name === 'string' ? r.name : undefined;
      }
      return undefined;
    })
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    // Google lists "models/<id>"; its OpenAI-compatible chat endpoint takes the bare id.
    .map((x) => (provider === 'google' ? x.replace(/^models\//, '') : x).trim());
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
