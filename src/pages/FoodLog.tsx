import { AnimatePresence, MotionConfig, animate, motion, useMotionValue, useTransform, type PanInfo } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { FoodSheet, minuteLabel } from '../components/FoodSheet';
import { WeighInSheet } from '../components/WeighInSheet';
import { MacroSummary, NutritionLabel, macroLine } from '../components/nutrition';
import { NumField, Page, Sheet, Switch } from '../components/ui';
import { targetFor } from '../domain/coach';
import { dayTotals, fmtEnergy, foodFromEntry, kcalFromMacros } from '../domain/nutrition';
import { dayIndex, fromIndex } from '../domain/trend';
import type { EnergyUnit, Food, LogEntry, ShortcutId } from '../domain/types';
import { fmtNum, isoDate, uid } from '../domain/util';
import { t } from '../i18n';
import { pickPhoto } from '../platform/camera';
import { haptic } from '../platform/haptics';
import { useAiDraft } from '../state/aiDraft';
import { useActiveGoal, useFoodLookup, useStore, useTimeLabel } from '../store';
import { Icon } from '../ui/icons';
import { Fab, type FabAction } from '../ui/Fab';
import { EmptyState } from '../ui/Illustration';
import { motionTokens, stagger } from '../ui/motion';
import { toast } from '../ui/snackbar';
import '../styles/food.css';

/** Horizontal distance (px) an entry must travel before a swipe action fires. */
const SWIPE = 96;
/** Remembered across day changes (each day is its own route). */
let lastMode: 'remaining' | 'consumed' = 'remaining';

export function QuickAddSheet({
  open,
  onClose,
  onSaved,
  date,
  minute,
  entry,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after a new quick-add entry is logged (not on edits or dismissals). */
  onSaved?: (e: LogEntry) => void;
  date: string;
  minute: number;
  entry?: LogEntry;
}) {
  const addEntries = useStore((s) => s.addEntries);
  const updateEntry = useStore((s) => s.updateEntry);
  const [name, setName] = useState(entry?.name ?? t('log.quickAdd'));
  const [p, setP] = useState<number | undefined>(entry?.n.protein);
  const [f, setF] = useState<number | undefined>(entry?.n.fat);
  const [c, setC] = useState<number | undefined>(entry?.n.carbs);
  const [kcal, setKcal] = useState<number | undefined>(entry?.n.kcal);
  const auto = kcalFromMacros(p ?? 0, c ?? 0, f ?? 0);
  // Nutrients this form does not show (fiber, sodium, vitamins…) are kept when editing.
  const others = entry ? Object.entries(entry.n).filter(([k, v]) => !['kcal', 'protein', 'fat', 'carbs'].includes(k) && v !== undefined).length : 0;
  return (
    <Sheet open={open} onClose={onClose} title={entry ? t('log.quickEditTitle') : t('log.quickAdd')}>
      <label className="lbl" htmlFor="qa-name">
        {t('log.quickLabel')}
      </label>
      <input id="qa-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid3">
        <div>
          <label className="lbl">{t('log.quickProtein')}</label>
          <NumField value={p} onChange={setP} ariaLabel={t('log.quickProtein')} />
        </div>
        <div>
          <label className="lbl">{t('log.quickFat')}</label>
          <NumField value={f} onChange={setF} ariaLabel={t('log.quickFat')} />
        </div>
        <div>
          <label className="lbl">{t('log.quickCarbs')}</label>
          <NumField value={c} onChange={setC} ariaLabel={t('log.quickCarbs')} />
        </div>
      </div>
      <label className="lbl">{t('log.quickKcal', { auto: Math.round(auto) })}</label>
      <NumField value={kcal} onChange={setKcal} ariaLabel={t('log.quickKcalShort')} />
      {others > 0 && <p className="muted tiny">{t('log.quickKeeps', { count: others })}</p>}
      <button
        className="btn primary block"
        style={{ marginTop: 14 }}
        disabled={!kcal && !auto}
        onClick={() => {
          const e: LogEntry = {
            id: entry?.id ?? uid(),
            date: entry?.date ?? date,
            minute: entry?.minute ?? minute,
            name: name.trim() || t('log.quickAdd'),
            icon: entry?.icon ?? '⚡',
            n: { ...entry?.n, kcal: kcal ?? auto, protein: p ?? 0, fat: f ?? 0, carbs: c ?? 0 },
          };
          if (entry) updateEntry(e);
          else {
            addEntries([e]);
            haptic('add');
            toast(t('log.added', { name: e.name }));
          }
          onClose();
          if (!entry) onSaved?.(e);
        }}
      >
        {t('common.save')}
      </button>
    </Sheet>
  );
}

const amountLabel = (e: LogEntry) => {
  if (e.qty === undefined || !e.servingLabel) return '';
  if (['g', 'ml', 'oz'].includes(e.servingLabel)) return `${fmtNum(e.qty, 1)} ${e.servingLabel} · `;
  return `${fmtNum(e.qty, 2)} × ${e.servingLabel} · `;
};

interface RowProps {
  e: LogEntry;
  index: number;
  appear: boolean;
  eu: EnergyUnit;
  selected: boolean;
  selecting: boolean;
  showTime: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onMenu: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

/** One logged food: tap opens it, long-press selects, swipe left deletes, swipe right duplicates. */
function EntryRow({ e, index, appear, eu, selected, selecting, showTime, onOpen, onToggle, onMenu, onDelete, onDuplicate }: RowProps) {
  const timeLabel = useTimeLabel();
  const x = useMotionValue(0);
  const delOpacity = useTransform(x, [-SWIPE, -20, 0], [1, 0.35, 0]);
  const dupOpacity = useTransform(x, [0, 20, SWIPE], [0, 0.35, 1]);
  const fg = useRef<HTMLDivElement>(null);
  const press = useRef<{ timer?: number; x: number; y: number; fired: boolean; dragged: boolean; armed: number }>({ x: 0, y: 0, fired: false, dragged: false, armed: 0 });
  useEffect(() => () => window.clearTimeout(press.current.timer), []);

  const cancelPress = () => {
    window.clearTimeout(press.current.timer);
    press.current.timer = undefined;
  };
  const onPointerDown = (ev: ReactPointerEvent) => {
    const p = press.current;
    p.fired = false;
    p.dragged = false;
    p.x = ev.clientX;
    p.y = ev.clientY;
    cancelPress();
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    p.timer = window.setTimeout(() => {
      p.timer = undefined;
      p.fired = true;
      haptic('select');
      onToggle();
    }, 450);
  };
  const onPointerMove = (ev: ReactPointerEvent) => {
    const p = press.current;
    if (p.timer !== undefined && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 8) cancelPress();
  };
  const onDrag = (_: unknown, info: PanInfo) => {
    const p = press.current;
    const zone = info.offset.x <= -SWIPE ? -1 : info.offset.x >= SWIPE ? 1 : 0;
    if (zone !== p.armed) {
      p.armed = zone;
      if (zone) haptic('select');
    }
  };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const dx = info.offset.x;
    const vx = info.velocity.x;
    press.current.armed = 0;
    if (dx <= -SWIPE || (dx < -48 && vx < -900)) {
      const w = fg.current?.offsetWidth ?? 360;
      void animate(x, -w, { duration: 0.16, ease: 'easeIn' }).then(onDelete);
      return;
    }
    if (dx >= SWIPE || (dx > 48 && vx > 900)) onDuplicate();
    void animate(x, 0, motionTokens.list);
  };

  return (
    <motion.div
      className="swipe-row"
      data-entry
      initial={appear ? { opacity: 0, y: 8 } : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto', transition: { ...motionTokens.list, delay: appear ? stagger(index) : 0 } }}
      exit={{ opacity: 0, height: 0, transition: motionTokens.base }}
    >
      <div className="swipe-bg" aria-hidden>
        <motion.span className="swipe-act dup" style={{ opacity: dupOpacity }}>
          {t('log.swipeDuplicate')}
        </motion.span>
        <motion.span className="swipe-act del" style={{ opacity: delOpacity }}>
          {t('log.swipeDelete')}
        </motion.span>
      </div>
      <motion.div
        ref={fg}
        className={`log-entry${selected ? ' sel' : ''}`}
        style={{ x }}
        drag={selecting ? false : 'x'}
        dragDirectionLock
        dragMomentum={false}
        dragElastic={0.9}
        onDragStart={() => {
          press.current.dragged = true;
          cancelPress();
        }}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
      >
        <button
          className="log-entry-main"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onPointerLeave={cancelPress}
          onContextMenu={(ev) => {
            ev.preventDefault();
            if (!press.current.fired) {
              press.current.fired = true;
              haptic('select');
              onToggle();
            }
          }}
          onClick={() => {
            const p = press.current;
            if (p.fired || p.dragged) {
              p.fired = false;
              p.dragged = false;
              return;
            }
            if (selecting) onToggle();
            else onOpen();
          }}
        >
          <span className="log-ico" aria-hidden>
            {e.icon}
          </span>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="log-name ellipsis">{e.name}</span>
            <span className="log-sub ellipsis num">
              {amountLabel(e)}
              {macroLine(e.n)}
              {showTime ? ` · ${timeLabel(e.minute)}` : ''}
            </span>
          </span>
          <span className="log-kcal num">{fmtEnergy(e.n.kcal, eu)}</span>
        </button>
        {selecting ? (
          <button className={`log-check${selected ? ' on' : ''}`} role="checkbox" aria-checked={selected} aria-label={t('log.selectEntry', { name: e.name })} onClick={onToggle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12l5 5L19 7" />
            </svg>
          </button>
        ) : (
          <button className="log-more" aria-label={t('log.entryActions', { name: e.name })} onClick={onMenu}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}

export default function FoodLog() {
  const params = useParams();
  const date = params.date ?? isoDate();
  const loc = useLocation();
  const dir = (loc.state as { dir?: number } | null)?.dir ?? 0;
  const st = useStore();
  const goal = useActiveGoal();
  const lookup = useFoodLookup();
  const nav = useNavigate();
  const eu = st.settings.energyUnit;
  const aiOn = st.settings.ai.enabled;
  const [mode, setModeState] = useState(lastMode);
  const [edit, setEdit] = useState<{ entry: LogEntry; food: Food; weighed: boolean } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [quick, setQuick] = useState<{ minute: number; entry?: LogEntry; key: number }>({ minute: 720, key: 0 });
  const [quickOpen, setQuickOpen] = useState(false);
  const [menu, setMenu] = useState<LogEntry | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  /** Move sheet: which entries, and the day and time they go to. */
  const [moveTo, setMoveTo] = useState<{ ids: string[]; date: string; time: string } | null>(null);
  const timeLabel = useTimeLabel();
  // A selection belongs to the day it was made on.
  useEffect(() => setSelected([]), [date]);
  const [copyTarget, setCopyTarget] = useState<string | null>(null);
  const [weighOpen, setWeighOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [openHour, setOpenHour] = useState<string | null>(null);
  const appear = useRef(true);
  useEffect(() => {
    appear.current = false;
  }, []);

  const entries = useMemo(() => st.log.filter((e) => e.date === date).sort((a, b) => a.minute - b.minute), [st.log, date]);
  const meta = st.meta.find((m) => m.date === date);
  const totals = dayTotals(entries);
  const target = targetFor(date, goal, st.snapshots);
  const now = new Date();
  const nowMinute = date === isoDate() ? now.getHours() * 60 : 12 * 60;
  const selecting = selected.length > 0;
  const setMode = (m: 'remaining' | 'consumed') => {
    lastMode = m;
    setModeState(m);
  };
  const go = (d: number) => {
    haptic('select');
    nav(`/log/${fromIndex(dayIndex(date) + d)}`, { replace: true, state: { dir: d } });
  };

  const groups = useMemo(() => {
    if (st.settings.timeline === 'meals') {
      const meals = [...st.settings.meals].sort((a, b) => a.minute - b.minute);
      return meals.map((m, i) => {
        const lo = i === 0 ? 0 : (meals[i - 1].minute + m.minute) / 2;
        const hi = i === meals.length - 1 ? 1440 : (m.minute + meals[i + 1].minute) / 2;
        return { key: m.name, label: m.name, minute: m.minute, items: entries.filter((e) => e.minute >= lo && e.minute < hi) };
      });
    }
    const hours = entries.map((e) => Math.floor(e.minute / 60));
    const first = Math.min(6, ...hours);
    const last = Math.max(22, ...hours);
    return Array.from({ length: last - first + 1 }, (_, i) => {
      const h = first + i;
      return { key: String(h), label: timeLabel(h * 60, true), minute: h * 60, items: entries.filter((e) => Math.floor(e.minute / 60) === h) };
    });
  }, [entries, st.settings.timeline, st.settings.meals, timeLabel]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const addWithUndo = (list: LogEntry[], message: string) => {
    if (!list.length) return;
    st.addEntries(list);
    haptic('add');
    toast(message, { label: t('common.undo'), run: () => useStore.getState().deleteEntries(list.map((e) => e.id)) });
  };
  const removeEntries = (list: LogEntry[]) => {
    if (!list.length) return;
    st.deleteEntries(list.map((e) => e.id));
    haptic('warning');
    toast(t('log.deleted', { count: list.length }), { label: t('common.undo'), run: () => useStore.getState().addEntries(list) });
  };
  const duplicate = (list: LogEntry[]) => addWithUndo(list.map((e) => ({ ...e, id: uid() })), t('log.duplicated'));
  const paste = () => addWithUndo(st.clipboard.map((e) => ({ ...e, id: uid(), date })), t('log.pasted', { count: st.clipboard.length }));
  const copyYesterday = () => {
    const y = fromIndex(dayIndex(date) - 1);
    const src = st.log.filter((e) => e.date === y);
    if (!src.length) return toast(t('log.nothingYesterday'));
    addWithUndo(
      src.map((e) => ({ ...e, id: uid(), date })),
      t('log.copiedDay', { count: src.length }),
    );
  };
  const today = isoDate();
  const tomorrow = fromIndex(dayIndex(today) + 1);
  const shortDay = (d: string) =>
    d === today ? t('log.today') : d === tomorrow ? t('log.tomorrow') : new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  /** Copies every food of the viewed day to another day at the same times. */
  const copyDayTo = (target: string) => {
    if (!entries.length || target === date) return;
    addWithUndo(
      entries.map((e) => ({ ...e, id: uid(), date: target })),
      t('log.copyDayDone', { count: entries.length, day: shortDay(target) }),
    );
  };
  const openEntry = (e: LogEntry) => {
    const food = e.foodId ? lookup(e.foodId) : undefined;
    // Entries without a library food (imports, AI estimates, deleted foods) are rebuilt from their
    // own snapshot so the amount stays editable; only bare quick adds open the macro editor.
    const target = food ? { food, weighed: !food.noWeight } : foodFromEntry(e);
    if (!target) return openQuick(e.minute, e);
    setEdit({ entry: e, ...target });
    setEditOpen(true);
  };
  const openQuick = (minute: number, entry?: LogEntry) => {
    setQuick((q) => ({ minute, entry, key: q.key + 1 }));
    setQuickOpen(true);
  };
  const openMenu = (e: LogEntry) => {
    setMenu(e);
    setMenuOpen(true);
  };
  const addUrl = (minute: number, extra = '') => `/add?date=${date}&minute=${minute}${extra}`;
  const snapMeal = async () => {
    const r = await pickPhoto('prompt');
    if (!r.ok) {
      if (r.reason !== 'cancelled') toast(r.reason);
      return;
    }
    useAiDraft.getState().setPendingPhoto(r.value);
    nav(addUrl(nowMinute, '&ai=snap'));
  };

  const shortcutActions: Record<ShortcutId, FabAction | null> = {
    describe: aiOn ? { label: t('log.describe'), icon: <Icon name="pen" />, onSelect: () => nav(addUrl(nowMinute, '&ai=describe')) } : null,
    snap: aiOn ? { label: t('log.snap'), icon: <Icon name="camera" />, onSelect: () => void snapMeal() } : null,
    quickAdd: { label: t('log.quickAdd'), icon: <Icon name="bolt" />, onSelect: () => openQuick(nowMinute) },
    scan: { label: t('log.scan'), icon: <Icon name="scan" />, onSelect: () => nav(addUrl(nowMinute, '&scan=1')) },
    search: { label: t('log.addFood'), icon: <Icon name="search" />, onSelect: () => nav(addUrl(nowMinute)) },
    water: {
      label: t('log.shortcutWater', { ml: 250 }),
      icon: <Icon name="drop" />,
      onSelect: () => {
        st.setMeta(date, { waterMl: (meta?.waterMl ?? 0) + 250 });
        haptic('add');
        toast(t('log.waterAdded', { ml: (meta?.waterMl ?? 0) + 250 }));
      },
    },
    weighIn: { label: t('log.shortcutWeigh'), icon: <Icon name="scale" />, onSelect: () => setWeighOpen(true) },
    copyYesterday: { label: t('log.copyPrevious'), icon: <Icon name="copy" />, onSelect: copyYesterday },
  };
  // The + menu shows the shortcuts chosen in Settings, in the user's order.
  const fabActions = st.settings.shortcuts.map((id) => shortcutActions[id]).filter((a): a is FabAction => !!a);

  // Day pager: a horizontal swipe on the timeline background (not on entries) changes day.
  const pager = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const onPagerDown = (ev: ReactPointerEvent) => {
    const el = ev.target as HTMLElement;
    pager.current = el.closest('[data-entry], input, textarea, select') ? null : { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
  };
  const onPagerUp = (ev: ReactPointerEvent) => {
    const s = pager.current;
    pager.current = null;
    if (!s || s.id !== ev.pointerId) return;
    const dx = ev.clientX - s.x;
    const dy = ev.clientY - s.y;
    if (Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      swiped.current = true;
      go(dx < 0 ? 1 : -1);
    }
  };

  const dateText = date === isoDate() ? t('log.today') : new Date(date + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const selectedEntries = entries.filter((e) => selected.includes(e.id));
  let rowIndex = 0;

  return (
    <MotionConfig reducedMotion="user">
      <Page
        title={t('log.title')}
        actions={
          <button className="btn sm" onClick={() => nav('/library')}>
            {t('log.myFoods')}
          </button>
        }
      >
        <div className="datebar card tight">
          <button className="icon-btn touch" aria-label={t('log.prevDay')} onClick={() => go(-1)}>
            ‹
          </button>
          <label className="grow date-label">
            <motion.span className="date-text" initial={dir ? { x: dir * 24, opacity: 0 } : false} animate={{ x: 0, opacity: 1 }} transition={motionTokens.base}>
              {dateText}
            </motion.span>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && nav(`/log/${e.target.value}`, { replace: true })}
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker?.();
                } catch {
                  /* picker needs a user gesture; the native control still works */
                }
              }}
              className="date-input"
              aria-label={t('log.pickDate')}
            />
          </label>
          <button className="icon-btn touch" aria-label={t('log.nextDay')} onClick={() => go(1)}>
            ›
          </button>
        </div>

        <div
          className="card summary-card"
          role="button"
          tabIndex={0}
          aria-label={mode === 'remaining' ? t('log.showConsumed') : t('log.showRemaining')}
          onClick={() => setMode(mode === 'remaining' ? 'consumed' : 'remaining')}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setMode(mode === 'remaining' ? 'consumed' : 'remaining'))}
        >
          <MacroSummary totals={totals} target={target} mode={mode} />
          <div className="row between" style={{ marginTop: 10 }}>
            <span className="muted tiny num">{t('log.summaryHint', { count: entries.length, other: mode === 'remaining' ? t('log.consumed') : t('log.remaining') })}</span>
            <button
              className="btn sm ghost"
              onClick={(e) => {
                e.stopPropagation();
                setDetails(true);
              }}
            >
              {t('log.dayDetails')}
            </button>
          </div>
        </div>

        {(meta?.partial || meta?.fasted) && <div className="card tight small day-flag">{meta.fasted ? t('log.flagFasted') : t('log.flagPartial')}</div>}

        <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
          {entries.length > 0 && date !== today && (
            <button className="btn sm primary" onClick={() => copyDayTo(today)}>
              {t('log.copyToToday')}
            </button>
          )}
          {entries.length > 0 && (
            <button className="btn sm" onClick={() => setCopyTarget(date === today ? tomorrow : today)}>
              {t('log.copyDay')}
            </button>
          )}
          <button className="btn sm" onClick={copyYesterday}>
            {t('log.copyPrevious')}
          </button>
          {st.clipboard.length > 0 && (
            <button className="btn sm" onClick={paste}>
              {t('log.paste', { count: st.clipboard.length })}
            </button>
          )}
        </div>

        {entries.length === 0 && (
          <div className="card">
            <EmptyState scene="empty-log" title={t('log.emptyTitle')}>
              <p className="muted small" style={{ margin: 0 }}>
                {t('log.emptySub')}
              </p>
              <button className="btn primary" style={{ marginTop: 8 }} onClick={() => nav(addUrl(nowMinute))}>
                {t('log.addFood')}
              </button>
            </EmptyState>
          </div>
        )}

        <motion.div
          className="card timeline"
          initial={dir ? { x: dir * 48, opacity: 0 } : false}
          animate={{ x: 0, opacity: 1 }}
          transition={motionTokens.sheet}
          onPointerDown={onPagerDown}
          onPointerUp={onPagerUp}
          onPointerCancel={() => (pager.current = null)}
          onClickCapture={(ev) => {
            if (swiped.current) {
              swiped.current = false;
              ev.stopPropagation();
              ev.preventDefault();
            }
          }}
        >
          {groups.map((g) => {
            const sub = dayTotals(g.items);
            return (
              <div key={g.key} className="hour">
                <div className="label">
                  {g.label}
                  {g.items.length > 0 && (
                    <button className="hour-sub num" aria-expanded={openHour === g.key} aria-label={t('log.hourSplit', { label: g.label })} onClick={() => setOpenHour(openHour === g.key ? null : g.key)}>
                      {fmtEnergy(sub.kcal, eu)}
                      <AnimatePresence initial={false}>
                        {openHour === g.key && (
                          <motion.span className="hour-split" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={motionTokens.fast}>
                            {macroLine(sub)}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </button>
                  )}
                </div>
                <div>
                  <AnimatePresence>
                    {g.items.map((e) => (
                      <EntryRow
                        key={e.id}
                        e={e}
                        index={rowIndex++}
                        appear={appear.current}
                        eu={eu}
                        selected={selected.includes(e.id)}
                        selecting={selecting}
                        showTime={st.settings.timeline === 'meals'}
                        onOpen={() => openEntry(e)}
                        onToggle={() => toggle(e.id)}
                        onMenu={() => openMenu(e)}
                        onDelete={() => removeEntries([e])}
                        onDuplicate={() => duplicate([e])}
                      />
                    ))}
                  </AnimatePresence>
                  <button className="add-hour" onClick={() => nav(addUrl(g.minute))}>
                    {g.items.length ? t('log.addMore') : t('log.addAt', { label: g.label })}
                  </button>
                </div>
              </div>
            );
          })}
        </motion.div>
        <div className="fab-spacer" aria-hidden />

        <AnimatePresence>
          {selecting && (
            <motion.div className="sel-bar" role="toolbar" aria-label={t('log.selectionBar')} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }} transition={motionTokens.sheet}>
              <div className="sel-bar-head">
                <b className="small grow num">{t('log.selected', { count: selected.length })}</b>
                {selected.length < entries.length && (
                  <button className="btn sm ghost" onClick={() => (haptic('select'), setSelected(entries.map((e) => e.id)))}>
                    {t('log.selectAll')}
                  </button>
                )}
                <button className="icon-btn touch" aria-label={t('log.clearSelection')} onClick={() => setSelected([])}>
                  ✕
                </button>
              </div>
              <div className="sel-bar-actions">
                <button
                  className="btn sm"
                  onClick={() => {
                    st.copy(selectedEntries);
                    toast(t('log.copied', { count: selectedEntries.length }));
                    setSelected([]);
                  }}
                >
                  {t('log.copy')}
                </button>
                <button className="btn sm" onClick={() => setMoveTo({ ids: selected, date, time: selected.length === 1 ? minuteLabel(selectedEntries[0]?.minute ?? 720) : '' })}>
                  {t('log.move')}
                </button>
                <button
                  className="btn sm"
                  onClick={() => {
                    duplicate(selectedEntries);
                    setSelected([]);
                  }}
                >
                  {t('log.duplicate')}
                </button>
                <button
                  className="btn sm danger"
                  onClick={() => {
                    removeEntries(selectedEntries);
                    setSelected([]);
                  }}
                >
                  {t('log.delete')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!selecting && fabActions.length > 0 && <Fab actions={fabActions} />}

        <WeighInSheet open={weighOpen} onClose={() => setWeighOpen(false)} />
        <FoodSheet
          open={editOpen}
          food={edit?.food}
          weighed={edit?.weighed}
          entry={edit?.entry}
          date={date}
          minute={edit?.entry.minute ?? nowMinute}
          onClose={() => setEditOpen(false)}
          onAdd={st.updateEntry}
          actionLabel={t('log.saveChanges')}
        />
        <QuickAddSheet key={quick.key} open={quickOpen} onClose={() => setQuickOpen(false)} date={date} minute={quick.minute} entry={quick.entry} />

        <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={menu?.name}>
          {menu && (
            <div className="action-list">
              <button
                className="action-item"
                onClick={() => {
                  setMenuOpen(false);
                  openEntry(menu);
                }}
              >
                {t('log.edit')}
              </button>
              <button
                className="action-item"
                onClick={() => {
                  setMenuOpen(false);
                  duplicate([menu]);
                }}
              >
                {t('log.duplicate')}
              </button>
              <button
                className="action-item"
                onClick={() => {
                  setMenuOpen(false);
                  setMoveTo({ ids: [menu.id], date, time: minuteLabel(menu.minute) });
                }}
              >
                {t('log.moveEllipsis')}
              </button>
              <button
                className="action-item"
                onClick={() => {
                  setMenuOpen(false);
                  st.copy([menu]);
                  toast(t('log.copied', { count: 1 }));
                }}
              >
                {t('log.copy')}
              </button>
              <button
                className="action-item"
                onClick={() => {
                  setMenuOpen(false);
                  haptic('select');
                  setSelected([menu.id]);
                }}
              >
                {t('log.select')}
              </button>
              <button
                className="action-item danger"
                onClick={() => {
                  setMenuOpen(false);
                  removeEntries([menu]);
                }}
              >
                {t('log.delete')}
              </button>
            </div>
          )}
        </Sheet>

        <Sheet open={moveTo !== null} onClose={() => setMoveTo(null)} title={t('log.moveTitle')}>
          <div className="chips" role="radiogroup" aria-label={t('log.moveDay')} style={{ marginBottom: 10 }}>
            {[...new Set([date, today, tomorrow, fromIndex(dayIndex(date) - 1)])].map((d) => (
              <button key={d} role="radio" aria-checked={moveTo?.date === d} className={`chip ${moveTo?.date === d ? 'on' : ''}`} onClick={() => moveTo && setMoveTo({ ...moveTo, date: d })}>
                {d === date ? t('log.sameDay') : shortDay(d)}
              </button>
            ))}
          </div>
          <div className="grid2">
            <div>
              <label className="lbl" htmlFor="move-date">
                {t('log.moveDay')}
              </label>
              <input id="move-date" className="field" type="date" value={moveTo?.date ?? date} onChange={(e) => moveTo && e.target.value && setMoveTo({ ...moveTo, date: e.target.value })} />
            </div>
            <div>
              <label className="lbl" htmlFor="move-time">
                {t('log.newTime')}
              </label>
              <input id="move-time" className="field" type="time" value={moveTo?.time ?? ''} onChange={(e) => moveTo && setMoveTo({ ...moveTo, time: e.target.value })} />
            </div>
          </div>
          {moveTo && moveTo.ids.length > 1 && !moveTo.time && <p className="muted tiny">{t('log.moveKeepTimes')}</p>}
          <button
            className="btn primary block"
            style={{ marginTop: 12 }}
            onClick={() => {
              if (!moveTo) return;
              // No time chosen: every entry keeps its own time.
              const [h, m] = moveTo.time ? moveTo.time.split(':').map(Number) : [NaN, NaN];
              const moved = st.log.filter((e) => moveTo.ids.includes(e.id));
              st.moveEntries(moveTo.ids, moveTo.date, Number.isNaN(h) ? undefined : h * 60 + (m || 0));
              haptic('success');
              toast(moveTo.date === date ? t('log.movedTime', { count: moved.length }) : t('log.movedDay', { count: moved.length, day: shortDay(moveTo.date) }), {
                label: t('common.undo'),
                run: () => moved.forEach((e) => useStore.getState().updateEntry(e)),
              });
              setSelected([]);
              setMoveTo(null);
            }}
          >
            {t('log.moveCount', { count: moveTo?.ids.length ?? 0 })}
          </button>
        </Sheet>

        <Sheet open={copyTarget !== null} onClose={() => setCopyTarget(null)} title={t('log.copyDayTitle')}>
          <p className="muted small" style={{ marginTop: 0 }}>
            {t('log.copyDaySub', { count: entries.length, day: dateText })}
          </p>
          <div className="chips" role="radiogroup" aria-label={t('log.copyDayTarget')} style={{ marginBottom: 10 }}>
            {[today, tomorrow]
              .filter((d) => d !== date)
              .map((d) => (
                <button key={d} role="radio" aria-checked={copyTarget === d} className={`chip ${copyTarget === d ? 'on' : ''}`} onClick={() => setCopyTarget(d)}>
                  {shortDay(d)}
                </button>
              ))}
          </div>
          <input className="field" type="date" value={copyTarget ?? ''} onChange={(e) => e.target.value && setCopyTarget(e.target.value)} aria-label={t('log.copyDayTarget')} />
          <button
            className="btn primary block"
            style={{ marginTop: 12 }}
            disabled={!copyTarget || copyTarget === date}
            onClick={() => {
              if (copyTarget) copyDayTo(copyTarget);
              setCopyTarget(null);
            }}
          >
            {copyTarget === date ? t('log.copyDaySame') : t('log.copyDayBtn', { count: entries.length, day: copyTarget ? shortDay(copyTarget) : '' })}
          </button>
        </Sheet>

        <Sheet open={details} onClose={() => setDetails(false)} title={t('log.dayDetails')}>
          <div className="list">
            <div className="row" style={{ padding: '10px 0' }}>
              <span className="grow">
                {t('log.partial')}
                <div className="muted small">{t('log.partialSub')}</div>
              </span>
              <Switch checked={!!meta?.partial} onChange={(v) => st.setMeta(date, { partial: v, fasted: v ? false : meta?.fasted })} label={t('log.partial')} />
            </div>
            <div className="row" style={{ padding: '10px 0' }}>
              <span className="grow">
                {t('log.fasted')}
                <div className="muted small">{t('log.fastedSub')}</div>
              </span>
              <Switch checked={!!meta?.fasted} onChange={(v) => st.setMeta(date, { fasted: v, partial: v ? false : meta?.partial })} label={t('log.fasted')} />
            </div>
            <div style={{ padding: '10px 0' }}>
              <div className="row between">
                <span>{t('log.water')}</span>
                <b className="num">{t('log.waterAmount', { ml: meta?.waterMl ?? 0, goal: st.settings.waterGoalMl })}</b>
              </div>
              <div className="row" style={{ marginTop: 6, gap: 6 }}>
                {[250, 500].map((ml) => (
                  <button key={ml} className="btn sm" onClick={() => (haptic('add'), st.setMeta(date, { waterMl: (meta?.waterMl ?? 0) + ml }))}>
                    {t('log.waterAdd', { ml })}
                  </button>
                ))}
                <button className="btn sm" onClick={() => st.setMeta(date, { waterMl: Math.max(0, (meta?.waterMl ?? 0) - 250) })}>
                  {t('log.waterRemove', { ml: 250 })}
                </button>
              </div>
            </div>
            <div style={{ padding: '10px 0' }}>
              <label className="lbl" htmlFor="day-note">
                {t('log.note')}
              </label>
              <textarea id="day-note" className="field" rows={2} value={meta?.note ?? ''} onChange={(e) => st.setMeta(date, { note: e.target.value })} />
            </div>
          </div>
          <h3>{t('log.nutrition')}</h3>
          <NutritionLabel n={totals} />
        </Sheet>
      </Page>
    </MotionConfig>
  );
}
