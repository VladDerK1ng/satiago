import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { del, get, set } from 'idb-keyval';
import { AI_PROVIDER_IDS, type AiProviderId } from '../domain/aiProviders';
import { isNative } from './native';

/** Name used before keys were stored per provider. It only ever held an Anthropic key. */
const LEGACY_KEY = 'ai-api-key';
const keyName = (provider: AiProviderId) => `ai-api-key:${provider}`;

async function read(name: string): Promise<string | undefined> {
  try {
    if (isNative()) return ((await SecureStorage.get(name)) as string | null) || undefined;
    return (await get<string>(`secret:${name}`)) || undefined;
  } catch {
    return undefined;
  }
}

async function write(name: string, value: string): Promise<void> {
  if (isNative()) await SecureStorage.set(name, value);
  else await set(`secret:${name}`, value);
}

async function erase(name: string): Promise<void> {
  if (isNative()) await SecureStorage.remove(name).catch(() => {});
  else await del(`secret:${name}`);
}

/**
 * AI key storage (AD-9): Android Keystore on device; IndexedDB on the web (less protected).
 * One key per provider, never in the store or backups. Without a provider, returns the first key
 * saved for any provider (useful to ask "is any AI key on this device?").
 */
export async function getAiKey(provider?: AiProviderId): Promise<string | undefined> {
  if (!provider) {
    for (const p of AI_PROVIDER_IDS) {
      const k = await getAiKey(p);
      if (k) return k;
    }
    return undefined;
  }
  return (await read(keyName(provider))) ?? (provider === 'anthropic' ? await read(LEGACY_KEY) : undefined);
}

export async function setAiKey(value: string, provider: AiProviderId = 'anthropic'): Promise<void> {
  await write(keyName(provider), value);
  // The per-provider name replaces the legacy one, so "Remove key" can't leave an old copy behind.
  if (provider === 'anthropic') await erase(LEGACY_KEY);
}

/** Removes one provider's key, or every AI key when no provider is given (Delete all data). */
export async function removeAiKey(provider?: AiProviderId): Promise<void> {
  const names = provider ? [keyName(provider)] : AI_PROVIDER_IDS.map(keyName);
  if (!provider || provider === 'anthropic') names.push(LEGACY_KEY);
  for (const n of names) await erase(n);
}

export const secretsAreHardwareBacked = () => isNative();
