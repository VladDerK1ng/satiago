import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scoreFood } from '../domain/nutrition';
import type { Food } from '../domain/types';
import { rankHistory } from '../domain/body';
import { t } from '../i18n';
import { isOnline } from '../platform/net';
import { offBarcode, offSearch } from '../platform/off';
import { useFoodLookup, useFoods, useStore } from '../store';
import { Illustration } from '../ui/Illustration';
import { toast } from '../ui/snackbar';
import { BarcodeScanner } from './BarcodeScanner';
import { FoodRow } from './nutrition';
import { Seg } from './ui';
import '../styles/food.css';

/** Shown before the user has any history. */
const POPULAR = ['egg-whole-raw', 'banana', 'oats-rolled-dry', 'chicken-breast-cooked', 'rice-white-cooked', 'milk-2pct', 'yogurt-greek-nonfat', 'apple', 'bread-whole-wheat', 'peanut-butter', 'coffee-black', 'salmon-atlantic-cooked'];

type Tab = 'search' | 'recent' | 'favorites' | 'mine';

/** Skeleton rows shown in the final list layout while something loads. */
export function SkeletonRows({ count = 3, label }: { count?: number; label?: string }) {
  return (
    <div className="list" aria-busy="true" aria-label={label} role="status">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="item skel-row">
          <span className="skeleton skel-thumb" />
          <span className="grow">
            <span className="skeleton skel-line" style={{ width: `${70 - i * 12}%` }} />
            <span className="skeleton skel-line short" />
          </span>
        </div>
      ))}
    </div>
  );
}

function useOnline() {
  const [online, setOnline] = useState(isOnline);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/**
 * Search across built-in, custom, recipe and online foods. Calls onPick with the chosen food.
 * Scanned barcodes resolve to a local food first, then Open Food Facts; unknown codes go to
 * `onUnknownBarcode` when given.
 */
export function FoodSearch({
  onPick,
  autoFocus = true,
  startScan = false,
  onUnknownBarcode,
  onCreateFood,
}: {
  onPick: (f: Food) => void;
  autoFocus?: boolean;
  /** Open the barcode scanner as soon as the search mounts. */
  startScan?: boolean;
  onUnknownBarcode?: (code: string) => void;
  /** Offer "Create custom food" in the empty state. Receives the current query. */
  onCreateFood?: (query: string) => void;
}) {
  const foods = useFoods();
  const lookup = useFoodLookup();
  const log = useStore((s) => s.log);
  const favorites = useStore((s) => s.favorites);
  const saveFood = useStore((s) => s.saveFood);
  const historySort = useStore((s) => s.settings.historySort);
  const setSettings = useStore((s) => s.setSettings);
  const online = useOnline();
  const [tab, setTab] = useState<Tab>('search');
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<Food[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [lookingUp, setLookingUp] = useState<string>();
  const [scan, setScan] = useState(startScan);

  useEffect(() => {
    setRemote(null);
  }, [q]);

  const recent = useMemo(
    () =>
      rankHistory(log, 'recent')
        .map((id) => lookup(id))
        .filter((f): f is Food => !!f)
        .slice(0, 50),
    [log, lookup],
  );
  const history = useMemo(
    () =>
      historySort === 'recent'
        ? recent
        : rankHistory(log, 'frequent')
            .map((id) => lookup(id))
            .filter((f): f is Food => !!f)
            .slice(0, 50),
    [historySort, recent, log, lookup],
  );

  const frequency = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of log) if (e.foodId) m.set(e.foodId, (m.get(e.foodId) ?? 0) + 1);
    return m;
  }, [log]);

  const results = useMemo(() => {
    let pool: Food[];
    if (tab === 'recent') pool = history;
    else if (tab === 'favorites') pool = favorites.map(lookup).filter((f): f is Food => !!f);
    else if (tab === 'mine') pool = foods.filter((f) => f.source !== 'builtin');
    else pool = foods;
    if (!q.trim()) {
      if (tab !== 'search') return pool;
      // New users have no history yet: suggest common staples instead of an empty screen.
      if (recent.length) return recent.slice(0, 15);
      return POPULAR.map((id) => lookup(id)).filter((f): f is Food => !!f);
    }
    return pool
      .map((f) => {
        // Frequency and own-food bonuses only rank foods that match; they never add a non-match.
        const base = scoreFood(f, q);
        return { f, s: base > 0 ? base + Math.min(10, (frequency.get(f.id) ?? 0) * 2) + (f.source !== 'builtin' ? 3 : 0) : 0 };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.f);
  }, [tab, q, foods, recent, history, favorites, lookup, frequency]);

  const searchOnline = async () => {
    if (!isOnline()) return toast(t('common.offline'));
    const query = q;
    setSearching(true);
    try {
      setRemote(await offSearch(query));
    } catch (e) {
      toast(t('food.search.offFailed', { reason: (e as Error).message }), { label: t('common.retry'), run: () => void searchOnline() });
    } finally {
      setSearching(false);
    }
  };

  const handleCode = async (code: string) => {
    setScan(false);
    const local = foods.find((f) => f.barcode === code);
    if (local) return onPick(local);
    if (!isOnline()) {
      toast(t('food.search.barcodeOffline'), onUnknownBarcode ? { label: t('food.search.createFood'), run: () => onUnknownBarcode(code) } : undefined);
      return;
    }
    setLookingUp(code);
    try {
      const f = await offBarcode(code);
      if (f) {
        saveFood(f); // keep a local copy so history and favorites resolve offline
        onPick(f);
      } else if (onUnknownBarcode) onUnknownBarcode(code);
      else toast(t('food.search.barcodeNotFound', { code }));
    } catch (e) {
      toast(t('food.search.barcodeFailed', { reason: (e as Error).message }), { label: t('common.retry'), run: () => void handleCode(code) });
    } finally {
      setLookingUp(undefined);
    }
  };
  // The scanner restarts when its callback changes, so hand it a stable one.
  const codeRef = useRef(handleCode);
  useEffect(() => {
    codeRef.current = handleCode;
  });
  const onCode = useCallback((code: string) => void codeRef.current(code), []);
  const closeScan = useCallback(() => setScan(false), []);

  const pickOnline = (f: Food) => {
    saveFood(f); // keep a local copy so history and favorites resolve offline
    onPick(f);
  };

  const canSearchOnline = tab === 'search' && q.trim().length > 1;
  const empty = !results.length && (q.trim() || tab !== 'search') && remote === null && !searching;
  const emptyTitle =
    q.trim() || tab === 'search'
      ? t('food.search.noResults')
      : tab === 'favorites'
        ? t('food.search.noFavorites')
        : tab === 'recent'
          ? t('food.search.noHistory')
          : t('food.search.noMine');

  return (
    <>
      <div className="search-bar">
        <input
          className="field"
          type="search"
          autoFocus={autoFocus}
          placeholder={t('food.search.placeholder')}
          aria-label={t('food.search.placeholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && canSearchOnline && !results.length && void searchOnline()}
        />
        <button className="icon-btn touch" aria-label={t('log.scan')} onClick={() => setScan(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M11 8v8M14 8v8M17 8v8" />
          </svg>
        </button>
      </div>
      <div style={{ margin: '8px 0' }}>
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            { value: 'search', label: t('food.search.tabAll') },
            { value: 'recent', label: t('food.search.tabHistory') },
            { value: 'favorites', label: t('food.search.tabFavorites') },
            { value: 'mine', label: t('food.search.tabMine') },
          ]}
        />
      </div>
      {tab === 'recent' && recent.length > 1 && (
        <div className="chips" role="radiogroup" aria-label={t('food.search.sortHistory')} style={{ marginBottom: 6 }}>
          {(['recent', 'frequent'] as const).map((v) => (
            <button key={v} role="radio" aria-checked={historySort === v} className={`chip ${historySort === v ? 'on' : ''}`} onClick={() => setSettings({ historySort: v })}>
              {v === 'recent' ? t('food.search.sortRecent') : t('food.search.sortFrequent')}
            </button>
          ))}
        </div>
      )}
      {!online && <div className="offline-banner">{t('common.offline')}</div>}
      {lookingUp && <SkeletonRows count={1} label={t('food.search.lookingUp', { code: lookingUp })} />}
      {tab === 'search' && !q && <div className="overline list-head">{recent.length > 0 ? t('food.search.recent') : t('food.search.popular')}</div>}
      <div className="list">
        {results.map((f) => (
          <FoodRow
            key={f.id}
            f={f}
            onClick={() => onPick(f)}
            right={
              favorites.includes(f.id) ? (
                <span className="fav-mark" role="img" aria-label={t('food.search.favorite')}>
                  ★
                </span>
              ) : undefined
            }
          />
        ))}
      </div>
      <AnimatePresence initial={false}>
        {empty && (
          <motion.div className="empty search-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Illustration scene="no-results" size={150} />
            <div className="empty-title">{emptyTitle}</div>
            {(canSearchOnline || onCreateFood) && (
              <div className="row wrap center" style={{ gap: 8 }}>
                {canSearchOnline && (
                  <button className="btn primary" onClick={() => void searchOnline()}>
                    {t('food.search.searchOff')}
                  </button>
                )}
                {onCreateFood && (
                  <button className="btn" onClick={() => onCreateFood(q.trim())}>
                    {t('food.search.createFood')}
                  </button>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {canSearchOnline && (results.length > 0 || remote !== null || searching) && (
        <div style={{ marginTop: 10 }}>
          {searching ? (
            <>
              <div className="overline list-head">{t('food.search.offSearching')}</div>
              <SkeletonRows count={4} label={t('food.search.offSearching')} />
            </>
          ) : remote === null ? (
            <button className="btn block" onClick={() => void searchOnline()}>
              {t('food.search.searchOffFor', { q: q.trim() })}
            </button>
          ) : (
            <>
              <div className="overline list-head">{t('food.search.offResults', { count: remote.length })}</div>
              {remote.length ? (
                <div className="list">
                  {remote.map((f) => (
                    <FoodRow key={f.id} f={f} onClick={() => pickOnline(f)} />
                  ))}
                </div>
              ) : (
                <div className="muted small" style={{ padding: '8px 2px' }}>
                  {t('food.search.offNone')}
                </div>
              )}
            </>
          )}
        </div>
      )}
      <BarcodeScanner open={scan} onClose={closeScan} onCode={onCode} />
    </>
  );
}
