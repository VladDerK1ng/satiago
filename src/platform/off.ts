import { offToFood, type OffProduct } from '../domain/off';
import type { Food } from '../domain/types';
import { t } from '../i18n';
import { isNative } from './native';
import { netFetch } from './net';

// Open Food Facts asks apps to identify themselves. Browsers do not let pages set User-Agent, so the
// header is only added in the Android app; it names the app and its repository, nothing personal.
const UA = {
  get headers(): Record<string, string> {
    return isNative() ? { Accept: 'application/json', 'User-Agent': 'Satiago/1.0 (https://github.com/VladDerK1ng/satiago)' } : { Accept: 'application/json' };
  },
};

export async function offBarcode(code: string, signal?: AbortSignal): Promise<Food | undefined> {
  const r = await netFetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`, { ...UA, signal });
  if (!r.ok) return undefined;
  const j = (await r.json()) as { status?: number; product?: OffProduct };
  return j.status === 1 && j.product ? offToFood({ ...j.product, code }) : undefined;
}

const FIELDS = 'code,product_name,brands,serving_size,serving_quantity,nutriments';

/**
 * Full-text product search. Uses Open Food Facts' search service; falls back to the legacy
 * endpoint, which is often rate-limited (503). In the Android app requests go through native HTTP
 * (CapacitorHttp), so the search service's CORS policy does not apply.
 */
export async function offSearch(q: string, signal?: AbortSignal): Promise<Food[]> {
  const toFoods = (list: OffProduct[] | undefined) => (list ?? []).map(offToFood).filter((f): f is Food => !!f);
  try {
    const r = await netFetch(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=25&fields=${FIELDS}`, { ...UA, signal });
    if (r.ok) return toFoods(((await r.json()) as { hits?: OffProduct[] }).hits);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
  }
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=25&fields=${FIELDS}`;
  let r: Response;
  try {
    r = await netFetch(url, { ...UA, signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    // Open Food Facts' name search does not allow requests from web pages (CORS); barcode lookup does.
    if (!isNative() && navigator.onLine !== false) throw new Error(t('food.search.webSearchUnavailable'));
    throw e;
  }
  if (!r.ok) throw new Error(r.status === 503 ? 'Open Food Facts search is busy right now. Try again in a minute, or scan the barcode.' : `Open Food Facts returned ${r.status}`);
  return toFoods(((await r.json()) as { products?: OffProduct[] }).products);
}
