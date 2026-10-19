/** Hosts the app may always contact at runtime (AD-7). */
export const ALLOWED_HOSTS = ['world.openfoodfacts.org', 'search.openfoodfacts.org', 'api.anthropic.com'] as const;

export class BlockedHostError extends Error {}

/**
 * The one extra host allowed: the API host of the AI provider configured in Settings. App sets it
 * from an effect whenever `settings.ai` changes; undefined allows no extra host.
 */
let aiHost: string | undefined;

export function setAiHost(host?: string): void {
  aiHost = host ? host.toLowerCase() : undefined;
}

/** Pure allow-list check: https only, to a fixed host or to the single extra AI host. */
export function isAllowedUrl(url: string, extraHost?: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.host.toLowerCase();
  return (ALLOWED_HOSTS as readonly string[]).includes(host) || (!!extraHost && host === extraHost.toLowerCase());
}

const urlOf = (input: string | URL | Request) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

const hostOf = (url: string) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

/** fetch() restricted to the allow-list. */
export function netFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = urlOf(input);
  if (!isAllowedUrl(url, aiHost)) {
    return Promise.reject(new BlockedHostError(`Blocked request to ${hostOf(url)}: not in the network allow-list.`));
  }
  return fetch(input, init);
}

export const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
