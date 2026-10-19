import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED_HOSTS, BlockedHostError, isAllowedUrl, netFetch, setAiHost } from './net';

describe('network allow-list (AD-7)', () => {
  it('always allows Open Food Facts and Anthropic over https', () => {
    expect([...ALLOWED_HOSTS]).toEqual(['world.openfoodfacts.org', 'search.openfoodfacts.org', 'api.anthropic.com']);
    expect(isAllowedUrl('https://world.openfoodfacts.org/api/v2/product/1.json')).toBe(true);
    expect(isAllowedUrl('https://search.openfoodfacts.org/search?q=x')).toBe(true);
    expect(isAllowedUrl('https://api.anthropic.com/v1/messages')).toBe(true);
  });

  it('blocks every other host when no AI host is set', () => {
    expect(isAllowedUrl('https://api.openai.com/v1/chat/completions')).toBe(false);
    expect(isAllowedUrl('https://fonts.googleapis.com/css')).toBe(false);
    expect(isAllowedUrl('https://world.openfoodfacts.org.evil.example/')).toBe(false);
  });

  it('allows exactly one extra host: the configured AI provider host', () => {
    expect(isAllowedUrl('https://api.openai.com/v1/models', 'api.openai.com')).toBe(true);
    expect(isAllowedUrl('https://API.OpenAI.com/v1/models', 'api.openai.com')).toBe(true);
    expect(isAllowedUrl('https://api.groq.com/openai/v1/models', 'api.openai.com')).toBe(false);
    expect(isAllowedUrl('https://evil.api.openai.com/v1', 'api.openai.com')).toBe(false);
  });

  it('matches the port of a custom host', () => {
    expect(isAllowedUrl('https://llm.example.com:8443/v1/models', 'llm.example.com:8443')).toBe(true);
    expect(isAllowedUrl('https://llm.example.com/v1/models', 'llm.example.com:8443')).toBe(false);
    expect(isAllowedUrl('https://api.openai.com:443/v1/models', 'api.openai.com')).toBe(true);
  });

  it('rejects plain http and malformed URLs, even for allowed hosts', () => {
    expect(isAllowedUrl('http://world.openfoodfacts.org/')).toBe(false);
    expect(isAllowedUrl('http://llm.example.com/v1', 'llm.example.com')).toBe(false);
    expect(isAllowedUrl('not a url')).toBe(false);
  });
});

describe('netFetch', () => {
  afterEach(() => {
    setAiHost(undefined);
    vi.unstubAllGlobals();
  });

  it('rejects blocked hosts without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(netFetch('https://api.openai.com/v1/models')).rejects.toBeInstanceOf(BlockedHostError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows the host set with setAiHost, and only that one', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    setAiHost('api.openai.com');
    await expect(netFetch('https://api.openai.com/v1/models')).resolves.toBeInstanceOf(Response);
    await expect(netFetch('https://api.mistral.ai/v1/models')).rejects.toBeInstanceOf(BlockedHostError);
    setAiHost('api.mistral.ai');
    await expect(netFetch('https://api.openai.com/v1/models')).rejects.toBeInstanceOf(BlockedHostError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
