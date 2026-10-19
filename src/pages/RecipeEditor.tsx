import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FoodSearch, SkeletonRows } from '../components/FoodSearch';
import { FoodSheet } from '../components/FoodSheet';
import { NutritionLabel, macroLine } from '../components/nutrition';
import { NumField, Page, Seg, Sheet, confirmDo } from '../components/ui';
import { matchItem } from '../domain/ai';
import { supportsUrlImport } from '../domain/aiProviders';
import { fmtEnergy, recipeToFood, scale } from '../domain/nutrition';
import type { Food, Recipe, RecipeIngredient } from '../domain/types';
import { isoDate, uid } from '../domain/util';
import { t } from '../i18n';
import { importRecipe } from '../platform/ai';
import { pickPhoto } from '../platform/camera';
import { haptic } from '../platform/haptics';
import { isOnline } from '../platform/net';
import { useFoodLookup, useFoods, useStore } from '../store';
import { EmptyState } from '../ui/Illustration';
import { motionTokens } from '../ui/motion';
import { toast } from '../ui/snackbar';
import '../styles/food.css';

const ICONS = ['🍲', '🥗', '🍝', '🍛', '🌯', '🥪', '🍜', '🥘', '🍳', '🥣', '🍰', '🥤'];
type ImportMode = 'text' | 'url' | 'photo';
const isUrl = (s: string) => /^https?:\/\/\S+\.\S+/i.test(s.trim());

export default function RecipeEditor() {
  const { id = 'new' } = useParams();
  const stored = useStore((s) => s.recipes.find((r) => r.id === id));
  const st = useStore();
  const ai = st.settings.ai;
  // Link import relies on Anthropic's server-side fetch; other providers import text and photos.
  const urlImport = supportsUrlImport(ai.provider);
  const foods = useFoods();
  const lookup = useFoodLookup();
  const nav = useNavigate();
  const eu = st.settings.energyUnit;
  const [r, setR] = useState<Recipe>(() => stored ?? { id: `recipe-${uid()}`, name: '', icon: '🍲', ingredients: [], servings: 1, createdAt: Date.now() });
  const [searching, setSearching] = useState(false);
  const [pick, setPick] = useState<Food>();
  const [pickOpen, setPickOpen] = useState(false);
  const [logAs, setLogAs] = useState(false);
  const [logMinute, setLogMinute] = useState(0);
  // AI-estimated ingredients become custom foods only when the recipe is saved (AD-8).
  const [pending, setPending] = useState<Food[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>('text');
  const [importText, setImportText] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [shot, setShot] = useState<{ blob: Blob; url: string }>();
  const [importing, setImporting] = useState(false);
  const photo = shot?.blob;
  const photoUrl = shot?.url;
  useEffect(() => {
    if (!photoUrl) return;
    return () => URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);
  const alive = useRef(true);
  const request = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  if (id !== 'new' && !stored)
    return (
      <Page title={t('food.recipe.title')} back>
        <EmptyState scene="empty-recipes" title={t('food.recipe.notFound')}>
          <button className="btn primary" onClick={() => nav('/library', { replace: true })}>
            {t('log.myFoods')}
          </button>
        </EmptyState>
      </Page>
    );

  const look = (x: string) => pending.find((f) => f.id === x) ?? lookup(x);
  const food = recipeToFood(r, (x) => (x === r.id ? undefined : look(x)));
  const perServing = scale(food.per100, food.servings[0].grams);
  const rawGrams = r.ingredients.reduce((tot, i) => tot + i.grams, 0);
  const pendingIds = new Set(pending.map((f) => f.id));
  const estimates = r.ingredients.filter((i) => pendingIds.has(i.foodId)).length;

  const save = () => {
    const used = new Set(r.ingredients.map((i) => i.foodId));
    for (const f of pending) if (used.has(f.id)) st.saveFood(f);
    st.saveRecipe({ ...r, name: r.name.trim() });
    haptic('add');
    toast(t('food.recipe.saved', { name: r.name.trim() }));
    nav(-1);
  };

  const canImport = !importing && (mode === 'text' ? importText.trim().length > 10 : mode === 'url' ? urlImport && isUrl(importUrl) : !!photo);
  const runImport = async () => {
    if (!canImport) return;
    if (!isOnline()) return toast(t('common.offline'));
    const input = mode === 'text' ? { text: importText.trim() } : mode === 'url' ? { url: importUrl.trim() } : { photo };
    const req = ++request.current;
    setImporting(true);
    const res = await importRecipe(ai, input);
    if (!alive.current || req !== request.current) return;
    setImporting(false);
    if (!res.ok) {
      haptic('warning');
      toast(res.reason, { label: t('common.retry'), run: () => void runImport() });
      return;
    }
    const d = res.value;
    const pool = foods.filter((f) => f.source !== 'recipe');
    const created: Food[] = [];
    const ingredients: RecipeIngredient[] = d.ingredients
      .filter((i) => i.grams > 0)
      .map((i) => {
        const grams = Math.round(i.grams * 10) / 10;
        const m = matchItem(i.name, i.grams, i.per100, pool, `${Math.round(i.grams)} g`);
        if (m.matched) return { foodId: m.food.id, grams };
        const est: Food = { ...m.food, id: `custom-${uid()}`, servings: [{ label: '100 g', grams: 100 }] };
        created.push(est);
        return { foodId: est.id, grams };
      });
    if (!ingredients.length) {
      toast(t('food.recipe.importEmpty'));
      return;
    }
    setPending((p) => [...p, ...created]);
    setR((cur) => ({
      ...cur,
      name: cur.name.trim() || d.name,
      servings: Math.max(1, Math.round(d.servings) || 1),
      steps: d.steps ?? cur.steps,
      ingredients: [...cur.ingredients, ...ingredients],
    }));
    setImportOpen(false);
    setShot(undefined);
    haptic('success');
    toast(t('food.recipe.imported', { count: ingredients.length }));
  };
  const choosePhoto = async () => {
    const p = await pickPhoto('prompt');
    if (p.ok) setShot({ blob: p.value, url: URL.createObjectURL(p.value) });
    else if (p.reason !== 'cancelled') toast(p.reason);
  };

  return (
    <Page title={stored ? t('food.recipe.editTitle') : t('food.recipe.newTitle')} back>
      {ai.enabled && (
        <button className="ai-action wide" onClick={() => setImportOpen(true)}>
          <span className="ai-ico" aria-hidden>
            ✎
          </span>
          <span className="grow">
            <span className="ai-action-title">{t('food.recipe.import')}</span>
            <span className="ai-action-sub">{urlImport ? t('food.recipe.importSub') : t('ai.importSubNoUrl')}</span>
          </span>
        </button>
      )}
      <label className="lbl" htmlFor="recipe-name">
        {t('food.recipe.name')}
      </label>
      <input id="recipe-name" className="field" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder={t('food.recipe.namePlaceholder')} />
      <label className="lbl">{t('food.editor.icon')}</label>
      <div className="chips" role="radiogroup" aria-label={t('food.editor.icon')}>
        {ICONS.map((i) => (
          <button key={i} role="radio" aria-checked={r.icon === i} className={`chip icon-chip ${r.icon === i ? 'on' : ''}`} onClick={() => setR({ ...r, icon: i })}>
            {i}
          </button>
        ))}
      </div>
      <div className="grid2">
        <div>
          <label className="lbl">{t('food.recipe.servings')}</label>
          <NumField className="field num" value={r.servings} min={1} ariaLabel={t('food.recipe.servings')} onChange={(v) => setR({ ...r, servings: Math.max(1, v ?? 1) })} />
        </div>
        <div>
          <label className="lbl">{t('food.recipe.cooked')}</label>
          <NumField className="field num" value={r.cookedGrams} ariaLabel={t('food.recipe.cooked')} placeholder={String(Math.round(rawGrams))} onChange={(v) => setR({ ...r, cookedGrams: v })} />
        </div>
      </div>

      <h2>{t('food.recipe.ingredients')}</h2>
      <div className="card list tight">
        {r.ingredients.length === 0 && (
          <div className="muted small" style={{ padding: 10 }}>
            {t('food.recipe.ingredientsHint')}
          </div>
        )}
        <AnimatePresence initial={false}>
          {r.ingredients.map((ing, i) => {
            const f = look(ing.foodId);
            const n = f ? scale(f.per100, ing.grams) : {};
            const est = pendingIds.has(ing.foodId);
            return (
              <motion.div
                key={`${ing.foodId}-${i}`}
                className="row ingredient-row"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={motionTokens.list}
              >
                <span className="thumb" aria-hidden>
                  {f?.icon ?? '❓'}
                </span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis small" style={{ fontWeight: 600 }}>
                    {f?.name ?? t('food.recipe.missing')}
                  </div>
                  <div className="tiny muted num">
                    {fmtEnergy(n.kcal, eu)} {eu} · {macroLine(n)}
                  </div>
                  {est && <span className="ai-badge estimate">{t('ai.estimate')}</span>}
                </span>
                <div style={{ width: 84 }}>
                  <NumField
                    className="field num"
                    value={ing.grams}
                    ariaLabel={t('food.recipe.gramsFor', { name: f?.name ?? '' })}
                    onChange={(v) => setR({ ...r, ingredients: r.ingredients.map((x, j) => (j === i ? { ...x, grams: v ?? 0 } : x)) })}
                  />
                </div>
                <button
                  className="icon-btn touch"
                  aria-label={t('food.recipe.remove', { name: f?.name ?? '' })}
                  onClick={() => setR({ ...r, ingredients: r.ingredients.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      {estimates > 0 && <p className="muted tiny">{t('food.recipe.estimatesNote', { count: estimates })}</p>}
      <button className="btn block" onClick={() => setSearching(true)}>
        {t('food.recipe.addIngredient')}
      </button>

      <label className="lbl" htmlFor="recipe-steps">
        {t('food.recipe.steps')}
      </label>
      <textarea id="recipe-steps" className="field" rows={3} value={r.steps ?? ''} onChange={(e) => setR({ ...r, steps: e.target.value })} />

      <h2>{t('food.recipe.perServing', { grams: Math.round(food.servings[0].grams) })}</h2>
      <div className="card">
        <NutritionLabel n={perServing} />
      </div>
      <button className="btn primary block" disabled={!r.name.trim() || !r.ingredients.length} onClick={save}>
        {t('food.recipe.save')}
      </button>
      {stored && (
        <>
          <button className="btn block" style={{ marginTop: 8 }} onClick={() => {
              const d = new Date();
              setLogMinute(d.getHours() * 60 + d.getMinutes());
              setLogAs(true);
            }}
          >
            {t('food.recipe.logNow')}
          </button>
          <button className="btn danger block" style={{ marginTop: 8 }} onClick={() => confirmDo(t('food.recipe.deleteConfirm'), () => (st.deleteRecipe(r.id), nav(-1)))}>
            {t('food.recipe.delete')}
          </button>
        </>
      )}

      <Sheet open={searching} onClose={() => setSearching(false)} title={t('food.recipe.addIngredientTitle')}>
        <FoodSearch
          onPick={(f) => {
            if (f.id === r.id) return;
            setPick(f);
            setPickOpen(true);
          }}
        />
      </Sheet>
      <FoodSheet
        open={pickOpen}
        food={pick}
        date={isoDate()}
        minute={0}
        actionLabel={t('food.recipe.addToRecipe')}
        onClose={() => setPickOpen(false)}
        onAdd={(e) => {
          // Foods without a known weight (imported recipes) are measured by their nominal serving weight,
          // which their per-100 g values are based on.
          const grams = e.grams ?? (pick?.servings.find((s) => s.label === e.servingLabel)?.grams ?? 0) * (e.qty ?? 1);
          setR((cur) => ({ ...cur, ingredients: [...cur.ingredients, { foodId: e.foodId!, grams: Math.round(grams * 10) / 10 }] }));
          haptic('add');
          setSearching(false);
        }}
      />
      <FoodSheet
        open={logAs}
        food={food}
        date={isoDate()}
        minute={logMinute}
        onClose={() => setLogAs(false)}
        onAdd={(e) => {
          st.addEntries([e]);
          haptic('add');
          toast(t('log.added', { name: e.name }));
        }}
      />

      <Sheet
        open={importOpen}
        onClose={() => {
          if (importing) {
            request.current++;
            setImporting(false);
          }
          setImportOpen(false);
        }}
        title={t('food.recipe.import')}
      >
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            { value: 'text', label: t('food.recipe.importText') },
            { value: 'url', label: t('food.recipe.importUrl') },
            { value: 'photo', label: t('food.recipe.importPhoto') },
          ]}
        />
        <fieldset className="plain-fieldset" disabled={importing} style={{ marginTop: 10 }}>
          {mode === 'text' && (
            <>
              <label className="lbl" htmlFor="import-text">
                {t('food.recipe.importTextLabel')}
              </label>
              <textarea id="import-text" className="field" rows={6} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={t('food.recipe.importTextPlaceholder')} />
            </>
          )}
          {mode === 'url' && urlImport && (
            <>
              <label className="lbl" htmlFor="import-url">
                {t('food.recipe.importUrlLabel')}
              </label>
              <input id="import-url" className="field" type="url" inputMode="url" value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://" />
              <p className="muted tiny">{t('food.recipe.importUrlHint')}</p>
            </>
          )}
          {mode === 'url' && !urlImport && <p className="muted small">{t('ai.urlImportAnthropicOnly')}</p>}
          {mode === 'photo' && (
            <div className="row" style={{ marginTop: 6 }}>
              {photoUrl && <img className="ai-thumb" src={photoUrl} alt={t('food.recipe.photoAlt')} />}
              <button className="btn" onClick={() => void choosePhoto()}>
                {photo ? t('food.recipe.changePhoto') : t('food.recipe.choosePhoto')}
              </button>
            </div>
          )}
        </fieldset>
        {importing && <SkeletonRows count={4} label={t('food.recipe.importing')} />}
        <p className="muted tiny">{t('ai.disclaimer')}</p>
        <button className="btn primary block" disabled={!canImport} onClick={() => void runImport()}>
          {importing ? t('food.recipe.importing') : t('food.recipe.importGo')}
        </button>
      </Sheet>
    </Page>
  );
}
