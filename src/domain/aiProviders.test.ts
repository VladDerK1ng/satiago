import { describe, expect, it } from 'vitest';
import { MealDraftSchema } from './ai';
import {
  AI_PROVIDER_IDS,
  AI_PROVIDERS,
  ANTHROPIC_MODELS,
  DEFAULT_ANTHROPIC_MODEL,
  PRESET_AI_HOSTS,
  aiHostFor,
  chatRequestBody,
  checkBaseUrl,
  defaultModelFor,
  errorDetail,
  httpErrorMessage,
  isAiProviderId,
  isResponseFormatRejection,
  jsonObjectFallback,
  jsonSchemaFor,
  normalizeAiSettings,
  parseJsonText,
  parseModelIds,
  providerPreset,
  readChatResponse,
  resolveBaseUrl,
  structuredFormat,
  supportsUrlImport,
} from './aiProviders';

describe('AI provider presets', () => {
  it('has one preset per provider id, in order', () => {
    expect(AI_PROVIDERS.map((p) => p.id)).toEqual([...AI_PROVIDER_IDS]);
  });

  it('uses the documented https base URLs', () => {
    const bases = Object.fromEntries(AI_PROVIDERS.map((p) => [p.id, p.baseUrl]));
    expect(bases).toEqual({
      anthropic: 'https://api.anthropic.com',
      openai: 'https://api.openai.com/v1',
      google: 'https://generativelanguage.googleapis.com/v1beta/openai',
      openrouter: 'https://openrouter.ai/api/v1',
      groq: 'https://api.groq.com/openai/v1',
      mistral: 'https://api.mistral.ai/v1',
      xai: 'https://api.x.ai/v1',
      deepseek: 'https://api.deepseek.com/v1',
      custom: '',
    });
  });

  it('routes only Anthropic through the Anthropic SDK', () => {
    for (const p of AI_PROVIDERS) expect(p.api).toBe(p.id === 'anthropic' ? 'anthropic' : 'openai-compatible');
  });

  it('suggests models only for Anthropic, with Opus as the default', () => {
    expect(ANTHROPIC_MODELS.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(DEFAULT_ANTHROPIC_MODEL).toBe('claude-opus-5-5');
    expect(defaultModelFor('anthropic')).toBe('claude-opus-5-5');
    for (const p of AI_PROVIDERS.filter((x) => x.id !== 'anthropic')) {
      expect(p.models).toEqual([]);
      expect(defaultModelFor(p.id)).toBe('');
    }
  });

  it('lists the preset hosts', () => {
    expect(PRESET_AI_HOSTS).toEqual([
      'api.anthropic.com',
      'api.openai.com',
      'generativelanguage.googleapis.com',
      'openrouter.ai',
      'api.groq.com',
      'api.mistral.ai',
      'api.x.ai',
      'api.deepseek.com',
    ]);
  });

  it('recognises provider ids and falls back to Anthropic for unknown ones', () => {
    expect(isAiProviderId('groq')).toBe(true);
    expect(isAiProviderId('nope')).toBe(false);
    expect(isAiProviderId(undefined)).toBe(false);
    expect(providerPreset('mistral').label).toBe('Mistral AI');
  });

  it('allows URL recipe import only with Anthropic', () => {
    expect(supportsUrlImport('anthropic')).toBe(true);
    for (const id of AI_PROVIDER_IDS.filter((x) => x !== 'anthropic')) expect(supportsUrlImport(id)).toBe(false);
  });
});

describe('checkBaseUrl', () => {
  it('accepts https and trims trailing slashes and whitespace', () => {
    expect(checkBaseUrl(' https://llm.example.com/v1/ ')).toEqual({ ok: true, value: 'https://llm.example.com/v1' });
    expect(checkBaseUrl('https://LLM.Example.com')).toEqual({ ok: true, value: 'https://llm.example.com' });
    expect(checkBaseUrl('https://llm.example.com:8443/api/v1')).toEqual({ ok: true, value: 'https://llm.example.com:8443/api/v1' });
  });

  it('rejects plain http', () => {
    expect(checkBaseUrl('http://llm.example.com/v1')).toEqual({ ok: false, problem: 'insecure' });
  });

  it('rejects empty input and non-URLs', () => {
    expect(checkBaseUrl('   ')).toEqual({ ok: false, problem: 'empty' });
    expect(checkBaseUrl('llm.example.com/v1')).toEqual({ ok: false, problem: 'invalid' });
    expect(checkBaseUrl('not a url')).toEqual({ ok: false, problem: 'invalid' });
    expect(checkBaseUrl('ftp://llm.example.com')).toEqual({ ok: false, problem: 'invalid' });
  });

  it('rejects credentials, queries and fragments', () => {
    expect(checkBaseUrl('https://user:pw@llm.example.com/v1')).toEqual({ ok: false, problem: 'credentials' });
    expect(checkBaseUrl('https://llm.example.com/v1?key=1')).toEqual({ ok: false, problem: 'query' });
    expect(checkBaseUrl('https://llm.example.com/v1#x')).toEqual({ ok: false, problem: 'query' });
  });
});

describe('base URL and host resolution', () => {
  it('uses the preset base for built-in providers and ignores a stored custom URL', () => {
    expect(resolveBaseUrl({ provider: 'openai', baseUrl: 'https://evil.example' })).toBe('https://api.openai.com/v1');
    expect(aiHostFor({ provider: 'openai', baseUrl: 'https://evil.example' })).toBe('api.openai.com');
    expect(aiHostFor({ provider: 'anthropic' })).toBe('api.anthropic.com');
    expect(aiHostFor({ provider: 'google' })).toBe('generativelanguage.googleapis.com');
  });

  it('uses a valid custom URL, keeping a non-default port in the host', () => {
    expect(resolveBaseUrl({ provider: 'custom', baseUrl: 'https://llm.example.com/v1/' })).toBe('https://llm.example.com/v1');
    expect(aiHostFor({ provider: 'custom', baseUrl: 'https://llm.example.com:8443/v1' })).toBe('llm.example.com:8443');
  });

  it('has no host for a custom provider without a valid https URL', () => {
    expect(aiHostFor({ provider: 'custom' })).toBeUndefined();
    expect(aiHostFor({ provider: 'custom', baseUrl: 'http://llm.example.com/v1' })).toBeUndefined();
    expect(resolveBaseUrl({ provider: 'custom', baseUrl: 'garbage' })).toBeUndefined();
  });
});

describe('normalizeAiSettings', () => {
  it('treats settings from before providers as Anthropic and keeps the model', () => {
    expect(normalizeAiSettings({ enabled: true, model: 'claude-sonnet-5-5' })).toEqual({ enabled: true, provider: 'anthropic', model: 'claude-sonnet-5-5' });
  });

  it('repairs missing or invalid values', () => {
    expect(normalizeAiSettings(undefined)).toEqual({ enabled: false, provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(normalizeAiSettings({ provider: 'bogus', enabled: 'yes' })).toEqual({ enabled: false, provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(normalizeAiSettings({ provider: 'groq' })).toEqual({ enabled: false, provider: 'groq', model: '' });
  });

  it('keeps a custom base URL', () => {
    expect(normalizeAiSettings({ enabled: false, provider: 'custom', model: 'm', baseUrl: 'https://x.example/v1' })).toEqual({
      enabled: false,
      provider: 'custom',
      model: 'm',
      baseUrl: 'https://x.example/v1',
    });
  });
});

describe('OpenAI-compatible request helpers', () => {
  it('builds a strict JSON schema from the zod schema without $schema', () => {
    const schema = jsonSchemaFor(MealDraftSchema);
    expect(schema.$schema).toBeUndefined();
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['items', 'note']);
    const format = structuredFormat('meal_draft', MealDraftSchema);
    expect(format).toMatchObject({ type: 'json_schema', json_schema: { name: 'meal_draft', strict: true } });
  });

  it('falls back to JSON mode with the schema in the system prompt', () => {
    const fb = jsonObjectFallback('SYSTEM', MealDraftSchema);
    expect(fb.format).toEqual({ type: 'json_object' });
    expect(fb.system.startsWith('SYSTEM')).toBe(true);
    expect(fb.system).toContain('JSON Schema');
    expect(fb.system).toContain('"confidence"');
  });

  it('sends text-only prompts as a string and images as content parts', () => {
    const text = chatRequestBody('m', 'sys', [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], { type: 'json_object' });
    expect(text).toEqual({
      model: 'm',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'a\n\nb' },
      ],
      response_format: { type: 'json_object' },
    });
    const img = chatRequestBody('m', 'sys', [
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } },
      { type: 'text', text: 'read' },
    ]);
    expect(img.messages[1].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } },
      { type: 'text', text: 'read' },
    ]);
    expect('response_format' in img).toBe(false);
  });

  it('detects structured-output rejections', () => {
    expect(isResponseFormatRejection(400, '{"error":{"message":"Invalid parameter: response_format of type json_schema is not supported"}}')).toBe(true);
    expect(isResponseFormatRejection(400, 'This response_format type is unavailable now')).toBe(true);
    expect(isResponseFormatRejection(400, 'model not found')).toBe(false);
    expect(isResponseFormatRejection(401, 'response_format')).toBe(false);
  });
});

describe('OpenAI-compatible response helpers', () => {
  it('extracts error details from common shapes', () => {
    expect(errorDetail('{"error":{"message":"Bad key","code":401}}')).toBe('Bad key');
    expect(errorDetail('[{"error":{"code":400,"message":"API key not valid"}}]')).toBe('API key not valid');
    expect(errorDetail('{"message":{"detail":[{"msg":"field required"}]}}')).toBe('field required');
    expect(errorDetail('{"detail":"Not found"}')).toBe('Not found');
    expect(errorDetail('Gateway timeout')).toBe('Gateway timeout');
  });

  it('explains HTTP errors in plain words', () => {
    expect(httpErrorMessage(401, 'x', 'OpenAI')).toMatch(/OpenAI rejected your API key/);
    expect(httpErrorMessage(403, 'no access', 'Groq')).toMatch(/doesn't allow this key.*no access/);
    expect(httpErrorMessage(404, 'no such model', 'Mistral AI')).toMatch(/couldn't find this model/);
    expect(httpErrorMessage(429, '', 'xAI (Grok)')).toMatch(/rate-limiting/);
    expect(httpErrorMessage(503, '', 'DeepSeek')).toMatch(/server problem \(503\)/);
    expect(httpErrorMessage(400, 'Image input is not supported for this model', 'DeepSeek', true)).toMatch(/can't read photos: Image input/);
    expect(httpErrorMessage(400, 'Image input is not supported', 'DeepSeek', false)).toMatch(/rejected the request \(400\)/);
  });

  it('reads the first choice, refusals and finish reason', () => {
    expect(readChatResponse({ choices: [{ finish_reason: 'stop', message: { content: '{"a":1}' } }] })).toEqual({ text: '{"a":1}', finishReason: 'stop', refusal: undefined });
    expect(readChatResponse({ choices: [{ message: { content: [{ type: 'text', text: '{"a"' }, { type: 'text', text: ':1}' }] } }] }).text).toBe('{"a":1}');
    expect(readChatResponse({ choices: [{ message: { content: null, refusal: 'No.' } }] }).refusal).toBe('No.');
    expect(readChatResponse({}).text).toBe('');
  });

  it('parses JSON with code fences or surrounding text', () => {
    expect(parseJsonText('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonText('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonText('Here you go: {"a":{"b":2}} Enjoy')).toEqual({ a: { b: 2 } });
    expect(parseJsonText('no json here')).toBeUndefined();
  });

  it('parses model lists, sorted and de-duplicated', () => {
    expect(parseModelIds({ object: 'list', data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }, { foo: 1 }] }, 'openai')).toEqual(['a', 'b']);
    expect(parseModelIds({ data: [{ id: 'models/gemini-x' }] }, 'google')).toEqual(['gemini-x']);
    expect(parseModelIds({ data: [{ id: 'models/keep' }] }, 'custom')).toEqual(['models/keep']);
    expect(parseModelIds({ models: [{ name: 'n1' }] }, 'custom')).toEqual(['n1']);
    expect(parseModelIds(null, 'openai')).toEqual([]);
  });
});
