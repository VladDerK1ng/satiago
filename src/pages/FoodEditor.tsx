import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { SkeletonRows } from '../components/FoodSearch';
import { NumField, Page, Seg, confirmDo } from '../components/ui';
import { labelToFood } from '../domain/ai';
import { MICROS, NUTRIENT_META, kcalFromMacros, scale } from '../domain/nutrition';
import type { Food, NutrientKey, Nutrients } from '../domain/types';
import { uid } from '../domain/util';
import { t } from '../i18n';
import { scanLabel } from '../platform/ai';
import { pickPhoto } from '../platform/camera';
import { haptic } from '../platform/haptics';
import { isOnline } from '../platform/net';
import { useFoodLookup, useStore } from '../store';
import { motionTokens } from '../ui/motion';
import { toast } from '../ui/snackbar';
import '../styles/food.css';

/** Category values are stored on foods (and shared with built-in data), so they stay untranslated. */
const CATEGORIES = ['Packaged', 'Fruits', 'Vegetables', 'Grains', 'Legumes', 'Nuts & Seeds', 'Dairy & Eggs', 'Meat', 'Seafood', 'Plant Protein', 'Fats & Oils', 'Condiments', 'Snacks & Sweets', 'Beverages', 'Prepared', 'Supplements'];
const ICONS = ['🍽', '🥗', '🍎', '🥦', '🍞', '🍚', '🍝', '🥩', '🍗', '🐟', '🥚', '🧀', '🥛', '🥜', '🍫', '🍪', '🥤', '☕', '🍺', '💊'];
const CORE: NutrientKey[] = ['kcal', 'protein', 'fat', 'carbs'];
const round2 = (n: Nutrients): Nutrients => Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Math.round((v ?? 0) * 100) / 100])) as Nutrients;

export default function FoodEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const lookup = useFoodLookup();
  const existing = id ? lookup(id) : undefined;
  const editable = !existing || existing.source === 'custom' || existing.source === 'openfoodfacts';
  const st = useStore();
  const ai = st.settings.ai;
  const nav = useNavigate();
  const first = existing?.servings[0] ?? { label: t('food.editor.defaultServing'), grams: 100 };
  const [f, setF] = useState<Food>(() =>
    existing && editable
      ? existing
      : {
          id: `custom-${uid()}`,
          name: existing ? t('food.editor.customCopy', { name: existing.name }) : (params.get('name') ?? ''),
          icon: existing?.icon ?? '🍽',
          category: existing?.category ?? 'Packaged',
          per100: existing?.per100 ?? {},
          servings: existing?.servings ?? [first],
          source: 'custom',
          barcode: existing ? undefined : params.get('barcode')?.replace(/\D/g, '') || undefined,
        },
  );
  const [label, setLabel] = useState(first.label);
  const [grams, setGrams] = useState<number | undefined>(first.grams);
  const [perServing, setPerServing] = useState<Nutrients>(() => scale(f.per100, first.grams));
  const [showMicros, setShowMicros] = useState(false);
  const [scan, setScan] = useState(false);
  const [reading, setReading] = useState<string>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!reading) return;
    return () => URL.revokeObjectURL(reading);
  }, [reading]);
  const autoKcal = kcalFromMacros(perServing.protein ?? 0, perServing.carbs ?? 0, perServing.fat ?? 0);
  const unit = f.liquid ? 'ml' : 'g';

  const set = (k: NutrientKey, v: number | undefined) => setPerServing({ ...perServing, [k]: v });
  const valid = f.name.trim() && grams && grams > 0 && (perServing.kcal !== undefined || autoKcal > 0);

  const save = () => {
    const n = { ...perServing, kcal: perServing.kcal ?? autoKcal };
    const food: Food = {
      ...f,
      name: f.name.trim(),
      per100: scale(n, (100 * 100) / grams!),
      servings: [{ label: label || t('food.editor.defaultServing'), grams: grams! }, ...f.servings.slice(1).filter((s) => s.label !== label)],
      source: f.source === 'openfoodfacts' ? 'openfoodfacts' : 'custom',
      // The serving size entered here is a real weight from now on.
      noWeight: undefined,
    };
    st.saveFood(food);
    haptic('add');
    toast(t('food.editor.saved', { name: food.name }));
    nav(-1);
  };

  const readLabel = async (photo: Blob) => {
    if (!isOnline()) return toast(t('common.offline'));
    setReading(URL.createObjectURL(photo));
    const r = await scanLabel(ai, photo);
    if (!alive.current) return;
    setReading(undefined);
    if (!r.ok) {
      haptic('warning');
      toast(r.reason, { label: t('common.retry'), run: () => void readLabel(photo) });
      return;
    }
    // AD-8: the label only prefills the form; the user still reviews and saves.
    const draft = labelToFood(r.value);
    const serving = draft.servings[0];
    setF((cur) => ({ ...cur, name: draft.name || cur.name, brand: draft.brand ?? cur.brand, liquid: draft.liquid, icon: cur.icon === '🍽' ? draft.icon : cur.icon }));
    setLabel(serving.label);
    setGrams(serving.grams);
    setPerServing(round2(scale(draft.per100, serving.grams)));
    if (MICROS.some((k) => draft.per100[k] !== undefined)) setShowMicros(true);
    haptic('success');
    toast(t('food.editor.labelRead'));
  };
  const scanNutritionLabel = async () => {
    const r = await pickPhoto('prompt');
    if (!r.ok) {
      if (r.reason !== 'cancelled') toast(r.reason);
      return;
    }
    await readLabel(r.value);
  };

  const onCode = useCallback((code: string) => {
    setF((cur) => ({ ...cur, barcode: code }));
    setScan(false);
  }, []);
  const closeScan = useCallback(() => setScan(false), []);

  return (
    <Page title={existing && editable ? t('food.editor.editTitle') : t('food.editor.newTitle')} back>
      {ai.enabled && (
        <AnimatePresence initial={false} mode="wait">
          {reading ? (
            <motion.div key="reading" className="card ai-working" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionTokens.base}>
              <div className="row">
                <img className="ai-thumb" src={reading} alt={t('food.editor.labelPhoto')} />
                <div className="grow">
                  <div className="overline">{t('food.editor.readingLabel')}</div>
                  <div className="muted small">{t('ai.disclaimer')}</div>
                </div>
              </div>
              <SkeletonRows count={2} label={t('food.editor.readingLabel')} />
            </motion.div>
          ) : (
            <motion.button key="scan" className="ai-action wide" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionTokens.fast} onClick={() => void scanNutritionLabel()}>
              <span className="ai-ico" aria-hidden>
                ◉
              </span>
              <span className="grow">
                <span className="ai-action-title">{t('food.editor.scanLabel')}</span>
                <span className="ai-action-sub">{t('food.editor.scanLabelSub')}</span>
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      )}
      <fieldset className="plain-fieldset" disabled={!!reading} aria-busy={!!reading}>
        <label className="lbl" htmlFor="food-name">
          {t('food.editor.name')}
        </label>
        <input id="food-name" className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('food.editor.namePlaceholder')} />
        <div className="grid2">
          <div>
            <label className="lbl" htmlFor="food-brand">
              {t('food.editor.brand')}
            </label>
            <input id="food-brand" className="field" value={f.brand ?? ''} onChange={(e) => setF({ ...f, brand: e.target.value || undefined })} />
          </div>
          <div>
            <label className="lbl" htmlFor="food-cat">
              {t('food.editor.category')}
            </label>
            <select id="food-cat" className="field" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {[...new Set([...CATEGORIES, f.category])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <label className="lbl">{t('food.editor.icon')}</label>
        <div className="chips" role="radiogroup" aria-label={t('food.editor.icon')}>
          {ICONS.map((i) => (
            <button key={i} role="radio" aria-checked={f.icon === i} className={`chip icon-chip ${f.icon === i ? 'on' : ''}`} onClick={() => setF({ ...f, icon: i })}>
              {i}
            </button>
          ))}
        </div>
        <h2>{t('food.editor.serving')}</h2>
        <Seg
          value={unit}
          onChange={(v) => setF({ ...f, liquid: v === 'ml' })}
          options={[
            { value: 'g', label: t('food.editor.byWeight') },
            { value: 'ml', label: t('food.editor.byVolume') },
          ]}
        />
        <div className="grid2">
          <div>
            <label className="lbl" htmlFor="food-serving">
              {t('food.editor.servingName')}
            </label>
            <input id="food-serving" className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('food.editor.servingPlaceholder')} />
          </div>
          <div>
            <label className="lbl">{t('food.editor.servingSize', { unit })}</label>
            <NumField value={grams} step={1} onChange={setGrams} ariaLabel={t('food.editor.servingSize', { unit })} />
          </div>
        </div>
        <p className="muted tiny">{t('food.editor.servingHint')}</p>
        <h2>{t('food.editor.perServing')}</h2>
        <div className="grid2">
          {CORE.map((k) => (
            <div key={k}>
              <label className="lbl">
                {NUTRIENT_META[k].label} ({NUTRIENT_META[k].unit})
              </label>
              <NumField
                className="field num"
                value={perServing[k] === undefined ? undefined : Math.round(perServing[k]! * 100) / 100}
                step={0.1}
                onChange={(v) => set(k, v)}
                ariaLabel={NUTRIENT_META[k].label}
                placeholder={k === 'kcal' ? String(Math.round(autoKcal)) : ''}
              />
            </div>
          ))}
        </div>
        <button className="btn sm" style={{ marginTop: 10 }} aria-expanded={showMicros} onClick={() => setShowMicros(!showMicros)}>
          {showMicros ? t('food.editor.hideMore') : t('food.editor.showMore')}
        </button>
        {showMicros && (
          <div className="grid2">
            {MICROS.map((k) => (
              <div key={k}>
                <label className="lbl">
                  {NUTRIENT_META[k].label} ({NUTRIENT_META[k].unit})
                </label>
                <NumField
                  className="field num"
                  value={perServing[k] === undefined ? undefined : Math.round(perServing[k]! * 100) / 100}
                  step={0.1}
                  onChange={(v) => set(k, v)}
                  ariaLabel={NUTRIENT_META[k].label}
                />
              </div>
            ))}
          </div>
        )}
        <h2>{t('food.editor.barcode')}</h2>
        <div className="row">
          <input
            className="field num"
            inputMode="numeric"
            aria-label={t('food.editor.barcode')}
            value={f.barcode ?? ''}
            onChange={(e) => setF({ ...f, barcode: e.target.value.replace(/\D/g, '') || undefined })}
            placeholder={t('food.editor.optional')}
          />
          <button className="btn" onClick={() => setScan(true)}>
            {t('food.editor.scan')}
          </button>
        </div>
      </fieldset>
      <button className="btn primary block" style={{ marginTop: 16 }} disabled={!valid || !!reading} onClick={save}>
        {t('food.editor.save')}
      </button>
      {existing && editable && (
        <button className="btn danger block" style={{ marginTop: 8 }} onClick={() => confirmDo(t('food.editor.deleteConfirm'), () => (st.deleteFood(existing.id), nav(-1)))}>
          {t('food.editor.delete')}
        </button>
      )}
      <BarcodeScanner open={scan} onClose={closeScan} onCode={onCode} />
    </Page>
  );
}
