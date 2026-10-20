import { motion } from 'motion/react';
import { useEffect, useId, useMemo, useState } from 'react';
import { ENTRY_FOOD_PREFIX, scale } from '../domain/nutrition';
import type { Food, LogEntry } from '../domain/types';
import { uid } from '../domain/util';
import { t } from '../i18n';
import { haptic } from '../platform/haptics';
import { useStore } from '../store';
import { motionTokens } from '../ui/motion';
import { MacroStrip, NutritionLabel } from './nutrition';
import { NumField, Sheet } from './ui';
import '../styles/food.css';

const GRAM = { label: 'g', grams: 1 };
const OZ = { label: 'oz', grams: 28.3495 };
const ML = { label: 'ml', grams: 1 };
const QUICK_QTY = [0.5, 1, 1.5, 2];

export const minuteLabel = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${String(h).padStart(2, '0')}:${mm}`;
};

/**
 * Pick serving and quantity for a food, then add it to the log (or update an entry).
 * `onAdd` receives a finished entry.
 */
export function FoodSheet({
  food,
  open,
  onClose,
  date,
  minute,
  entry,
  onAdd,
  actionLabel = t('food.sheet.add'),
  weighed: weighedProp,
}: {
  food?: Food;
  open: boolean;
  onClose: () => void;
  date: string;
  minute: number;
  entry?: LogEntry;
  onAdd: (e: LogEntry) => void;
  actionLabel?: string;
  /** False when the food has no known weight: only its own servings are offered. */
  weighed?: boolean;
}) {
  const favorites = useStore((s) => s.favorites);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const rememberServing = useStore((s) => s.rememberServing);
  const weighed = weighedProp ?? !food?.noWeight;
  const pillId = useId();
  const units = useMemo(() => (food ? [...food.servings, ...(weighed ? [food.liquid ? ML : GRAM, OZ] : [])] : []), [food, weighed]);
  const [unitIdx, setUnitIdx] = useState(0);
  const [qty, setQty] = useState<number | undefined>(1);
  const [time, setTime] = useState(minute);

  useEffect(() => {
    if (!open || !food) return;
    setTime(entry?.minute ?? minute);
    const find = (label: string) => units.findIndex((u) => u.label.toLowerCase() === label.toLowerCase());
    if (entry) {
      // Editing keeps the entry's serving. If that serving no longer exists (or the entry only has a
      // weight), show the logged weight in g/ml so saving never changes the amount by accident.
      const i = entry.servingLabel ? find(entry.servingLabel) : -1;
      const w = units.findIndex((u) => u.grams === 1);
      if (i >= 0) {
        setUnitIdx(i);
        setQty(entry.qty ?? 1);
      } else if (entry.grams && w >= 0) {
        setUnitIdx(w);
        setQty(Math.round(entry.grams * 10) / 10);
      } else {
        setUnitIdx(0);
        setQty(entry.qty ?? 1);
      }
      return;
    }
    // A new log starts from the serving used last time for this food.
    const last = useStore.getState().servingMemory[food.id];
    const i = last ? find(last.label) : -1;
    setUnitIdx(i >= 0 ? i : 0);
    setQty(i >= 0 ? last!.qty : 1);
  }, [open, food, entry, minute, units]);

  if (!food) return null;
  const unit = units[unitIdx] ?? units[0];
  const grams = (qty ?? 0) * unit.grams;
  const n = scale(food.per100, grams);
  const fav = favorites.includes(food.id);
  // Rebuilt from a log entry: no library food behind it, so it cannot be a favorite.
  const fromLog = food.id.startsWith(ENTRY_FOOD_PREFIX);
  const per = food.liquid ? 'ml' : 'g';

  return (
    <Sheet open={open} onClose={onClose} title={food.name}>
      <div className="row between" style={{ marginTop: -6 }}>
        <span className="muted small">
          {fromLog ? (
            t('food.sheet.fromLog')
          ) : (
            <>
              {food.brand ? `${food.brand} · ` : ''}
              {food.category}
              {food.source === 'openfoodfacts' ? ` · ${t('food.source.off')}` : food.source === 'usda' ? ` · ${t('food.source.usda')}` : ''}
            </>
          )}
        </span>
        {!fromLog && (
          <button
            className={`btn sm fav-btn${fav ? ' on' : ''}`}
            aria-pressed={fav}
            onClick={() => {
              haptic('select');
              toggleFavorite(food.id);
            }}
          >
            <motion.span key={String(fav)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={motionTokens.sheet} aria-hidden>
              {fav ? '★' : '☆'}
            </motion.span>
            {fav ? t('food.sheet.favorited') : t('food.sheet.favorite')}
          </button>
        )}
      </div>
      <div className="grid2" style={{ marginTop: 10 }}>
        <div>
          <label className="lbl">{t('food.sheet.quantity')}</label>
          <NumField value={qty} step={0.25} min={0} onChange={setQty} ariaLabel={t('food.sheet.quantity')} />
        </div>
        <div>
          <label className="lbl">{t('food.sheet.serving')}</label>
          <select
            className="field"
            aria-label={t('food.sheet.serving')}
            value={unitIdx}
            onChange={(e) => {
              const i = Number(e.target.value);
              // Keep the same grams when switching to a weight unit.
              const next = units[i];
              if (next.grams <= 30 && unit.grams > 30) setQty(Math.round((grams / next.grams) * 10) / 10);
              else if (next.grams > 30 && unit.grams <= 30) setQty(Math.round((grams / next.grams) * 100) / 100 || 1);
              setUnitIdx(i);
            }}
          >
            {units.map((u, i) => (
              <option key={i} value={i}>
                {u.label}
                {/* Skip the gram hint when the label already states it (e.g. "100 g"). */}
                {weighed && u.grams !== 1 && u.label !== 'oz' && !/\d\s*(g|ml)\b/i.test(u.label) ? ` (${Math.round(u.grams)} ${per})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="chips qty-chips" role="radiogroup" aria-label={t('food.sheet.quickQty')}>
        {QUICK_QTY.map((q) => {
          const on = qty === q;
          return (
            <button
              key={q}
              role="radio"
              aria-checked={on}
              className={`chip qty-chip${on ? ' on' : ''}`}
              onClick={() => {
                if (!on) haptic('select');
                setQty(q);
              }}
            >
              {on && <motion.span layoutId={`qty-pill-${pillId}`} className="chip-pill" transition={motionTokens.sheet} aria-hidden />}
              <span className="chip-text num">{q}×</span>
            </button>
          );
        })}
        <label className="chip">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <input
            type="time"
            aria-label={t('food.sheet.time')}
            value={minuteLabel(time)}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number);
              if (!Number.isNaN(h)) setTime(h * 60 + (m || 0));
            }}
            className="chip-time"
          />
        </label>
      </div>
      {weighed && (
        <div className="muted small num" style={{ marginBottom: 8 }}>
          {t('food.sheet.total', { amount: Math.round(grams), unit: per })}
        </div>
      )}
      <MacroStrip n={n} />
      <NutritionLabel n={n} />
      <div className="sheet-cta">
        <button
          className="btn primary block"
          disabled={!qty}
          onClick={() => {
            if (!fromLog && qty) rememberServing(food.id, unit.label, qty);
            onAdd({
              id: entry?.id ?? uid(),
              date: entry?.date ?? date,
              minute: time,
              name: food.name,
              icon: food.icon,
              foodId: fromLog ? entry?.foodId : food.id,
              grams: weighed ? grams : undefined,
              qty,
              servingLabel: unit.label,
              n,
            });
            onClose();
          }}
        >
          {actionLabel}
        </button>
      </div>
    </Sheet>
  );
}
