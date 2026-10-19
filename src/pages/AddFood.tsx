import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FoodSearch, SkeletonRows } from '../components/FoodSearch';
import { FoodSheet } from '../components/FoodSheet';
import { Page, Sheet } from '../components/ui';
import { matchItem, matchMeal, type MealDraft } from '../domain/ai';
import { fmtEnergy } from '../domain/nutrition';
import type { Food, LogEntry } from '../domain/types';
import { isoDate } from '../domain/util';
import { t } from '../i18n';
import { describeMeal, snapMeal } from '../platform/ai';
import { pickPhoto } from '../platform/camera';
import { haptic } from '../platform/haptics';
import type { Result } from '../platform/native';
import { isOnline } from '../platform/net';
import { useAiDraft, type AiDraft, type DraftItem } from '../state/aiDraft';
import { useFoods, useStore, useTimeLabel } from '../store';
import { motionTokens } from '../ui/motion';
import { toast } from '../ui/snackbar';
import { QuickAddSheet } from './FoodLog';
import '../styles/food.css';

export default function AddFood() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? isoDate();
  const minute = Number(params.get('minute') ?? new Date().getHours() * 60);
  const addEntries = useStore((s) => s.addEntries);
  const deleteEntries = useStore((s) => s.deleteEntries);
  const eu = useStore((s) => s.settings.energyUnit);
  const ai = useStore((s) => s.settings.ai);
  const foods = useFoods();
  const timeLabel = useTimeLabel();
  const nav = useNavigate();
  const [food, setFood] = useState<Food>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [added, setAdded] = useState<LogEntry[]>([]);
  const [quickOpen, setQuickOpen] = useState(false);
  const [startScan] = useState(() => params.get('scan') === '1');
  const [describeOpen, setDescribeOpen] = useState(() => ai.enabled && params.get('ai') === 'describe');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<null | 'describe' | 'snap'>(null);
  const [preview, setPreview] = useState<string>();
  const alive = useRef(true);
  const request = useRef(0);
  const done = () => nav(`/log/${date}`, { replace: true });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // One-shot params (?scan=1, ?ai=…) are consumed on arrival so Back doesn't replay them.
  useEffect(() => {
    if (!params.has('scan') && !params.has('ai')) return;
    const next = new URLSearchParams(params);
    next.delete('scan');
    next.delete('ai');
    setParams(next, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = (f: Food) => {
    setFood(f);
    setSheetOpen(true);
  };

  const toDraft = (d: MealDraft, source: AiDraft['source']): AiDraft => {
    const matched = matchMeal(d, foods);
    const items: DraftItem[] = matched.map((m, i) => {
      if (!m.matched) return m;
      // Keep the AI's own estimate so the user can switch if the database match is wrong.
      const src = d.items[i];
      return { ...m, alt: matchItem(src.name, src.grams, src.per100, [], src.portion, src.confidence) };
    });
    return { date, minute, source, items, note: d.note };
  };

  const finish = (id: number, r: Result<MealDraft>, source: AiDraft['source'], retry: () => void) => {
    if (!alive.current || id !== request.current) return;
    setBusy(null);
    setPreview(undefined);
    if (!r.ok) {
      haptic('warning');
      toast(r.reason, { label: t('common.retry'), run: retry });
      return;
    }
    if (!r.value.items.length) {
      toast(t('ai.nothingFound'));
      return;
    }
    useAiDraft.getState().setDraft(toDraft(r.value, source));
    setDescribeOpen(false);
    nav('/ai/review');
  };

  const runDescribe = async () => {
    const q = text.trim();
    if (!q || busy) return;
    if (!isOnline()) return toast(t('common.offline'));
    const id = ++request.current;
    setBusy('describe');
    const r = await describeMeal(ai, q);
    finish(id, r, 'describe', () => void runDescribe());
  };

  const analyzePhoto = async (photo: Blob) => {
    if (!isOnline()) return toast(t('common.offline'));
    const id = ++request.current;
    setBusy('snap');
    setPreview(URL.createObjectURL(photo));
    const r = await snapMeal(ai, photo);
    finish(id, r, 'snap', () => void analyzePhoto(photo));
  };

  const pickAndSnap = async () => {
    const r = await pickPhoto('prompt');
    if (!r.ok) {
      if (r.reason !== 'cancelled') toast(r.reason);
      return;
    }
    await analyzePhoto(r.value);
  };

  const cancelAi = () => {
    request.current++;
    setBusy(null);
    setPreview(undefined);
  };

  // A photo picked from the Food Log speed dial arrives through the draft store.
  const analyzeRef = useRef(analyzePhoto);
  useEffect(() => {
    analyzeRef.current = analyzePhoto;
  });
  useEffect(() => {
    const photo = useAiDraft.getState().takePendingPhoto();
    if (photo) void analyzeRef.current(photo);
  }, []);

  const plateKcal = added.reduce((tot, a) => tot + (a.n.kcal ?? 0), 0);

  return (
    <MotionConfig reducedMotion="user">
      <Page
        title={t('food.add.title', { time: timeLabel(minute) })}
        back
        actions={
          <button className="btn sm primary" onClick={done}>
            {added.length ? t('food.add.doneCount', { count: added.length }) : t('food.add.done')}
          </button>
        }
      >
        {ai.enabled && (
          <div className="ai-actions">
            <button className="ai-action" disabled={!!busy} onClick={() => setDescribeOpen(true)}>
              <span className="ai-ico" aria-hidden>
                ✎
              </span>
              <span className="grow">
                <span className="ai-action-title">{t('log.describe')}</span>
                <span className="ai-action-sub">{t('ai.describeSub')}</span>
              </span>
            </button>
            <button className="ai-action" disabled={!!busy} onClick={() => void pickAndSnap()}>
              <span className="ai-ico" aria-hidden>
                ◉
              </span>
              <span className="grow">
                <span className="ai-action-title">{t('log.snap')}</span>
                <span className="ai-action-sub">{t('ai.snapSub')}</span>
              </span>
            </button>
          </div>
        )}

        <AnimatePresence initial={false}>
          {busy === 'snap' && (
            <motion.div className="card ai-working" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={motionTokens.base}>
              <div className="row">
                {preview && <img className="ai-thumb" src={preview} alt={t('ai.photoAlt')} />}
                <div className="grow">
                  <div className="overline">{t('ai.working')}</div>
                  <div className="muted small">{t('ai.snapWorking')}</div>
                </div>
                <button className="btn sm ghost" onClick={cancelAi}>
                  {t('common.cancel')}
                </button>
              </div>
              <SkeletonRows count={3} label={t('ai.working')} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
          <button className="btn sm" onClick={() => setQuickOpen(true)}>
            {t('log.quickAdd')}
          </button>
          <button className="btn sm" onClick={() => nav('/foods/new')}>
            {t('food.add.customFood')}
          </button>
          <button className="btn sm" onClick={() => nav('/recipes/new')}>
            {t('food.add.recipe')}
          </button>
        </div>

        <AnimatePresence initial={false}>
          {added.length > 0 && (
            <motion.div className="card tight small plate" layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={motionTokens.list}>
              <span className="overline">{t('food.add.plate')}</span>
              <div className="num">
                {t('food.add.plateLine', { names: added.map((a) => a.name).join(', '), kcal: fmtEnergy(plateKcal, eu), unit: eu })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <FoodSearch
          onPick={pick}
          autoFocus={!startScan && !describeOpen}
          startScan={startScan}
          onUnknownBarcode={(code) => {
            toast(t('food.scan.notFound', { code }));
            nav(`/foods/new?barcode=${encodeURIComponent(code)}`);
          }}
          onCreateFood={(q) => nav(q ? `/foods/new?name=${encodeURIComponent(q)}` : '/foods/new')}
        />

        <FoodSheet
          open={sheetOpen}
          food={food}
          date={date}
          minute={minute}
          onClose={() => setSheetOpen(false)}
          onAdd={(e) => {
            addEntries([e]);
            setAdded((a) => [...a, e]);
            haptic('add');
            toast(t('log.added', { name: e.name }), {
              label: t('common.undo'),
              run: () => {
                deleteEntries([e.id]);
                setAdded((a) => a.filter((x) => x.id !== e.id));
              },
            });
          }}
        />
        <QuickAddSheet open={quickOpen} date={date} minute={minute} onClose={() => setQuickOpen(false)} onSaved={done} />

        <Sheet
          open={describeOpen}
          onClose={() => {
            if (busy === 'describe') cancelAi();
            setDescribeOpen(false);
          }}
          title={t('log.describe')}
        >
          <label className="lbl" htmlFor="ai-describe">
            {t('ai.describeLabel')}
          </label>
          <textarea
            id="ai-describe"
            className="field"
            rows={4}
            autoFocus
            value={text}
            placeholder={t('ai.describePlaceholder')}
            readOnly={busy === 'describe'}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="muted tiny">{t('ai.describeHint')}</p>
          {busy === 'describe' && <SkeletonRows count={3} label={t('ai.working')} />}
          <button className="btn primary block" style={{ marginTop: 12 }} disabled={!text.trim() || !!busy} onClick={() => void runDescribe()}>
            {busy === 'describe' ? t('ai.working') : t('ai.estimateBtn')}
          </button>
        </Sheet>
      </Page>
    </MotionConfig>
  );
}
