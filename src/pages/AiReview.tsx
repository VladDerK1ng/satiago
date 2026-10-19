import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MacroStrip, macroLine } from '../components/nutrition';
import { NumField, Page } from '../components/ui';
import type { MatchedItem } from '../domain/ai';
import { fmtEnergy, scale, sum } from '../domain/nutrition';
import type { LogEntry } from '../domain/types';
import { isoDate, uid } from '../domain/util';
import { t, type StringKey } from '../i18n';
import { haptic } from '../platform/haptics';
import { useAiDraft, type DraftItem } from '../state/aiDraft';
import { useStore, useTimeLabel } from '../store';
import { EmptyState } from '../ui/Illustration';
import { motionTokens, stagger } from '../ui/motion';
import { toast } from '../ui/snackbar';
import '../styles/food.css';

const CONFIDENCE: Record<MatchedItem['confidence'], StringKey> = {
  high: 'ai.confHigh',
  medium: 'ai.confMedium',
  low: 'ai.confLow',
  database: 'ai.matched',
};

/** Review screen for AI meal drafts (FR-43, FR-44). Nothing is logged until "Add all" (AD-8). */
export default function AiReview() {
  const draft = useAiDraft((s) => s.draft);
  const timeLabel = useTimeLabel();
  const updateItem = useAiDraft((s) => s.updateItem);
  const replaceItem = useAiDraft((s) => s.replaceItem);
  const removeItem = useAiDraft((s) => s.removeItem);
  const clear = useAiDraft((s) => s.clear);
  const addEntries = useStore((s) => s.addEntries);
  const eu = useStore((s) => s.settings.energyUnit);
  const nav = useNavigate();
  const committed = useRef(false);
  const firstPaint = useRef(true);
  useEffect(() => {
    firstPaint.current = false;
    // Drop the draft only after it was logged, once this screen is gone (avoids a flash of the empty state).
    return () => {
      if (committed.current) clear();
    };
  }, [clear]);

  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) nav(-1);
    else nav('/log', { replace: true });
  };

  if (!draft)
    return (
      <Page title={t('ai.reviewTitle')} back>
        <EmptyState scene="no-results" title={t('ai.noDraft')}>
          <p className="muted small" style={{ margin: 0 }}>
            {t('ai.noDraftSub')}
          </p>
          <button className="btn primary" style={{ marginTop: 8 }} onClick={goBack}>
            {t('ai.back')}
          </button>
        </EmptyState>
      </Page>
    );

  const valid = draft.items.filter((i) => i.grams > 0);
  const totals = sum(valid.map((i) => scale(i.food.per100, i.grams)));
  const when = `${draft.date === isoDate() ? t('log.today') : new Date(draft.date + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${timeLabel(draft.minute)}`;

  const swap = (i: DraftItem) => {
    const { alt, ...current } = i;
    if (!alt) return;
    haptic('select');
    replaceItem(i.id, { ...alt, id: i.id, grams: i.grams, alt: current });
  };

  const addAll = () => {
    if (committed.current || !valid.length) return;
    committed.current = true;
    const entries: LogEntry[] = valid.map((i) => {
      const unit = i.food.liquid ? 'ml' : 'g';
      return {
        id: uid(),
        date: draft.date,
        minute: draft.minute,
        name: i.food.name,
        icon: i.food.icon,
        // Estimates are not saved as foods; they log like quick adds with a full nutrient snapshot.
        foodId: i.matched ? i.food.id : undefined,
        grams: i.grams,
        qty: i.matched ? i.grams : undefined,
        servingLabel: i.matched ? unit : undefined,
        n: scale(i.food.per100, i.grams),
      };
    });
    addEntries(entries);
    haptic('success');
    toast(t('ai.addedCount', { count: entries.length }));
    nav(`/log/${draft.date}`, { replace: true });
  };

  return (
    <MotionConfig reducedMotion="user">
      <Page title={t('ai.reviewTitle')} back>
        <div className="card ai-totals">
          <div className="row between">
            <span className="overline">{t('ai.total')}</span>
            <span className="muted tiny num">{when}</span>
          </div>
          <MacroStrip n={totals} />
        </div>

        {draft.note && <p className="muted small ai-note">{draft.note}</p>}

        {draft.items.length === 0 ? (
          <EmptyState scene="no-results" title={t('ai.allRemoved')}>
            <button className="btn" onClick={goBack}>
              {t('ai.back')}
            </button>
          </EmptyState>
        ) : (
          <div className="card list tight">
            <AnimatePresence initial={true}>
              {draft.items.map((i, idx) => {
                const n = scale(i.food.per100, i.grams);
                const heardAs = i.matched && i.alt && i.alt.name.toLowerCase() !== i.food.name.toLowerCase() ? i.alt.name : undefined;
                return (
                  <motion.div
                    key={i.id}
                    className="ai-item"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0, transition: { ...motionTokens.list, delay: firstPaint.current ? stagger(idx) : 0 } }}
                    exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, transition: motionTokens.base }}
                  >
                    <div className="ai-item-head">
                      <span className="log-ico" aria-hidden>
                        {i.food.icon}
                      </span>
                      <div className="grow">
                        <div className="log-name ellipsis">{i.food.name}</div>
                        <div className="log-sub num">
                          {i.portion ? `${i.portion} · ` : ''}
                          {fmtEnergy(n.kcal, eu)} {eu} · {macroLine(n)}
                        </div>
                        {heardAs && <div className="log-sub ellipsis">{t('ai.heardAs', { name: heardAs })}</div>}
                      </div>
                      <button
                        className="icon-btn touch"
                        aria-label={t('ai.remove', { name: i.food.name })}
                        onClick={() => {
                          haptic('select');
                          removeItem(i.id);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="ai-item-foot">
                      <span className={`ai-badge ${i.matched ? 'matched' : 'estimate'}`}>
                        {i.matched ? t('ai.matched') : t('ai.estimateConf', { estimate: t('ai.estimate'), level: t(CONFIDENCE[i.confidence]) })}
                      </span>
                      {i.alt && (
                        <button className="link-btn" onClick={() => swap(i)}>
                          {i.matched ? t('ai.useEstimate') : t('ai.useMatch')}
                        </button>
                      )}
                      <label className="ai-grams">
                        <NumField
                          className="field num"
                          value={i.grams || undefined}
                          min={0}
                          step={5}
                          ariaLabel={t('ai.gramsFor', { name: i.food.name })}
                          onChange={(v) => updateItem(i.id, { grams: Math.max(0, v ?? 0) })}
                        />
                        <span aria-hidden>{i.food.liquid ? 'ml' : 'g'}</span>
                      </label>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        <p className="ai-disclaimer">{t('ai.disclaimer')}</p>
        <div className="sticky-cta">
          <button className="btn primary block" disabled={!valid.length} onClick={addAll}>
            {t('ai.addAll', { count: valid.length })}
          </button>
        </div>
      </Page>
    </MotionConfig>
  );
}
