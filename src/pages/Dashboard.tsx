import confetti from 'canvas-confetti';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MacroSummary } from '../components/nutrition';
import { Page, Seg, Sheet, Switch } from '../components/ui';
import { WeighInSheet } from '../components/WeighInSheet';
import { energyBalance, habitCalendar, habitStats } from '../domain/body';
import { checkInDue, goalProgress, nextCheckIn, targetFor } from '../domain/coach';
import { dayTotals, fmtEnergy, KJ_PER_KCAL } from '../domain/nutrition';
import { goalDailyDelta } from '../domain/targets';
import { dayIndex, fromIndex, projectWeight } from '../domain/trend';
import type { DashboardCardId } from '../domain/types';
import { fmtNum, isoDate } from '../domain/util';
import { t, type StringKey } from '../i18n';
import { haptic } from '../platform/haptics';
import { useActiveGoal, useAnalysis, useStore } from '../store';
import { CalorieRing } from '../ui/CalorieRing';
import { Illustration } from '../ui/Illustration';
import { motionTokens, prefersReducedMotion, stagger } from '../ui/motion';
import { Ticker } from '../ui/Ticker';

export const tooltipStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 12, color: 'var(--color-text)' };

const CARD_NAMES: Record<DashboardCardId, StringKey> = {
  today: 'dashboard.card.today',
  expenditure: 'dashboard.card.expenditure',
  trend: 'dashboard.card.trend',
  goal: 'dashboard.card.goal',
  insights: 'dashboard.card.insights',
  week: 'dashboard.card.week',
  habits: 'dashboard.card.habits',
};
/** Weeks shown in the habit calendar (columns), Monday-first rows. */
const HABIT_WEEKS = 12;

const celebrated = 'satiago-goal-celebrated';

export default function Dashboard() {
  const st = useStore();
  const goal = useActiveGoal();
  const today = isoDate();
  const a = useAnalysis(today);
  const nav = useNavigate();
  const [range, setRange] = useState(30);
  const [customize, setCustomize] = useState(false);
  const [habit, setHabit] = useState<'food' | 'weigh'>('food');
  const [weighOpen, setWeighOpen] = useState(false);
  const eu = st.settings.energyUnit;
  const unit = st.settings.weightUnit;
  const e = (k: number | undefined) => (k === undefined ? undefined : eu === 'kJ' ? Math.round(k * KJ_PER_KCAL) : Math.round(k));

  const todays = st.log.filter((x) => x.date === today);
  const totals = dayTotals(todays);
  const target = targetFor(today, goal, st.snapshots);
  const due = checkInDue(goal, st.snapshots, today);

  const balance = useMemo(() => {
    const from = dayIndex(today) - range + 1;
    const exp = new Map(a.expenditure.map((p) => [p.date, p.expenditure]));
    return Array.from({ length: range }, (_, i) => {
      const d = fromIndex(from + i);
      const items = st.log.filter((x) => x.date === d);
      const meta = st.meta.find((m) => m.date === d);
      const kcal = items.length ? dayTotals(items).kcal : meta?.fasted ? 0 : undefined;
      return { date: d.slice(5), intake: e(kcal), expenditure: e(exp.get(d)) };
    });
  }, [a.expenditure, st.log, st.meta, range, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const trend = a.trend.filter((p) => dayIndex(p.date) > dayIndex(today) - range);
  const lastTrend = a.trend.at(-1)?.trend;
  const week = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => fromIndex(dayIndex(today) - i));
    const logged = days.filter((d) => st.log.some((x) => x.date === d));
    const tot = dayTotals(st.log.filter((x) => logged.includes(x.date)));
    const tg = logged.map((d) => targetFor(d, goal, st.snapshots)).filter((x) => !!x);
    const avg = (v?: number) => (logged.length ? (v ?? 0) / logged.length : undefined);
    return {
      logged: logged.length,
      kcal: avg(tot.kcal),
      protein: avg(tot.protein),
      targetKcal: tg.length ? tg.reduce((s, x) => s + x!.kcal, 0) / tg.length : undefined,
      targetProtein: tg.length ? tg.reduce((s, x) => s + x!.protein, 0) / tg.length : undefined,
    };
  }, [st.log, goal, st.snapshots, today]);

  const progress = goal && lastTrend !== undefined ? goalProgress(goal, lastTrend) : undefined;
  const goalRateUnit = goal ? ((goalDailyDelta(goal, a.currentWeightKg, a.kcalPerKg) * 7) / a.kcalPerKg) * (unit === 'kg' ? 1 : 2.20462) : 0;
  const projected = lastTrend !== undefined ? projectWeight(lastTrend, a.ratePerWeek, goalRateUnit, 30, st.settings.projection) : undefined;
  const energy = useMemo(() => energyBalance(st.log, st.meta, a.expenditure, today, 7), [st.log, st.meta, a.expenditure, today]);
  // Weight change the energy balance implies, in the user's unit per week.
  const impliedRate = energy ? ((energy.balance * 7) / a.kcalPerKg) * (unit === 'kg' ? 1 : 2.20462) : undefined;
  const calendar = useMemo(() => {
    // Start on the Monday HABIT_WEEKS - 1 weeks before this week, so columns are whole weeks.
    const dow = (new Date(today + 'T00:00').getDay() + 6) % 7;
    const from = fromIndex(dayIndex(today) - dow - (HABIT_WEEKS - 1) * 7);
    return habitCalendar(st.log, st.meta, st.body, from, today);
  }, [st.log, st.meta, st.body, today]);
  // Streaks look at the whole history, not just the 12 weeks on screen.
  const stats = useMemo(() => {
    const first = [...st.log.map((e) => e.date), ...st.body.filter((b) => b.weight !== undefined).map((b) => b.date)].sort()[0];
    const all = first && first < (calendar[0]?.date ?? today) ? habitCalendar(st.log, st.meta, st.body, first, today) : calendar;
    return habitStats(all, habit);
  }, [st.log, st.meta, st.body, calendar, habit, today]);
  const habitDone = calendar.filter((d) => (habit === 'food' ? d.food : d.weigh)).length;
  // Monday-first weeks as columns; days after today in the current week are shown as upcoming.
  const weeks = useMemo(() => {
    const out: { date: string; done: boolean; future: boolean }[][] = [];
    const start = calendar.length ? dayIndex(calendar[0].date) : dayIndex(today);
    const by = new Map(calendar.map((d) => [d.date, habit === 'food' ? d.food : d.weigh]));
    for (let w = 0; w < HABIT_WEEKS; w++) {
      out.push(
        Array.from({ length: 7 }, (_, i) => {
          const date = fromIndex(start + w * 7 + i);
          return { date, done: !!by.get(date), future: date > today };
        }),
      );
    }
    return out;
  }, [calendar, habit, today]);
  const weekDone = weeks.at(-1)?.filter((d) => d.done).length ?? 0;
  const narrowDays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' })), []);
  const reached = !!goal && goal.type !== 'maintain' && progress !== undefined && progress >= 1;

  // Celebrate a reached goal once (FR-6).
  useEffect(() => {
    if (!reached || !goal) return;
    try {
      if (localStorage.getItem(celebrated) === goal.id) return;
      localStorage.setItem(celebrated, goal.id);
    } catch {
      /* storage unavailable: celebrate anyway */
    }
    haptic('success');
    if (!prefersReducedMotion()) confetti({ particleCount: 140, spread: 75, origin: { y: 0.35 }, colors: ['#2BB673', '#3FD089', '#F2B544', '#5AA2F2', '#F07A63'], disableForReducedMotion: true });
  }, [reached, goal]);

  const cards: Record<DashboardCardId, React.ReactNode> = {
    today: (
      <div className="card">
        <div className="row between">
          <span className="overline">{t('dashboard.today')}</span>
          <button className="btn sm primary" onClick={() => nav(`/add?date=${today}&minute=${new Date().getHours() * 60}`)}>
            + {t('dashboard.logFood')}
          </button>
        </div>
        <CalorieRing totals={totals} target={target} energyLabel={eu} toDisplay={(k) => (eu === 'kJ' ? k * KJ_PER_KCAL : k)} />
        <MacroSummary totals={totals} target={target} />
      </div>
    ),
    expenditure: (
      <div className="card">
        <div className="row between">
          <div className="stat">
            <span className="overline">{t('dashboard.expenditure')}</span>
            <b className="num-xl">
              <Ticker value={e(a.current) ?? 0} /> <span className="small muted">{eu}</span>
              {a.currentSd !== undefined && (
                <span className="small muted" title={t('dashboard.uncertainty')}>
                  {' '}± {e(a.currentSd)}
                </span>
              )}
            </b>
          </div>
          <span className={`tag ${a.held ? '' : 'tag-live'}`}>{a.held ? t('dashboard.holding') : t('dashboard.updating')}</span>
        </div>
        <ResponsiveContainer width="100%" height={170}>
          <ComposedChart data={balance} margin={{ left: -14, right: 4, top: 10 }}>
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} minTickGap={20} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} domain={[0, 'auto']} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: 'var(--color-text-faint)', strokeWidth: 1 }} />
            <Bar dataKey="intake" name={t('dashboard.intake')} fill="var(--color-accent)" fillOpacity={0.5} radius={[6, 6, 0, 0]} />
            <Line dataKey="expenditure" name={t('dashboard.expenditure')} stroke="var(--color-expenditure)" strokeWidth={2.5} dot={false} isAnimationActive={!prefersReducedMotion()} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="muted tiny">{t('dashboard.expenditureHint')}</div>
      </div>
    ),
    trend: (
      <div className="card">
        <div className="row between">
          <span className="overline">{t('dashboard.trend')}</span>
          <button className="btn sm primary" onClick={() => setWeighOpen(true)}>
            + {t('dashboard.logWeight')}
          </button>
        </div>
        <Link to="/more/body" style={{ display: 'block' }} aria-label={t('dashboard.openBody')}>
        <div className="row between" style={{ marginTop: 4 }}>
          <div className="stat">
            <b className="num-xl">
              {lastTrend !== undefined ? <Ticker value={lastTrend} format={(v) => fmtNum(v)} /> : '–'} <span className="small muted">{unit}</span>
            </b>
          </div>
          <div className="stat" style={{ textAlign: 'right' }}>
            <span className="overline">{t('dashboard.weeklyRate')}</span>
            <b>
              {a.ratePerWeek === undefined ? '–' : `${a.ratePerWeek > 0 ? '+' : ''}${fmtNum(a.ratePerWeek, 2)}`} <span className="small muted">{unit}</span>
            </b>
          </div>
        </div>
        {trend.filter((p) => p.weight !== undefined).length > 1 ? (
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={trend.map((p) => ({ ...p, date: p.date.slice(5) }))} margin={{ left: -14, right: 4, top: 10 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} minTickGap={20} />
              <YAxis domain={['dataMin - 0.5', 'dataMax + 0.5']} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickFormatter={(v: number) => fmtNum(v)} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: 'var(--color-text-faint)', strokeWidth: 1 }} />
              <Line dataKey="weight" name={t('body.scale')} stroke="var(--color-text-faint)" strokeWidth={0} dot={{ r: 2.5, fill: 'var(--color-text-faint)' }} isAnimationActive={false} />
              <Line dataKey="trend" name={t('body.trendLine')} stroke="var(--color-accent)" strokeWidth={2.5} dot={false} isAnimationActive={!prefersReducedMotion()} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="muted small" style={{ padding: '12px 0' }}>
            {t('dashboard.trendEmpty')}
          </div>
        )}
        {projected !== undefined && (
          <div className="muted tiny">{t('dashboard.projected', { weight: fmtNum(projected), unit })}</div>
        )}
        </Link>
      </div>
    ),
    goal:
      goal && goal.type !== 'maintain' && progress !== undefined ? (
        <div className={`card ${reached ? 'accent' : ''}`}>
          {reached ? (
            <div className="row">
              <Illustration scene="goal-reached" size={120} />
              <div className="grow">
                <h3>{t('dashboard.goalReached')}</h3>
                <p className="muted small" style={{ margin: '0 0 8px' }}>
                  {t('dashboard.goalReachedSub', { weight: fmtNum(lastTrend), unit })}
                </p>
                <button className="btn sm primary" onClick={() => nav('/goal')}>
                  {t('dashboard.newGoal')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="row between">
                <span className="overline">{t('dashboard.goalProgress')}</span>
                <b>
                  <Ticker value={Math.round(progress * 100)} />%
                </b>
              </div>
              <div className="progress" style={{ margin: '10px 0 6px' }}>
                <motion.div initial={{ width: 0 }} animate={{ width: `${progress * 100}%` }} transition={motionTokens.slow} />
              </div>
              <div className="row between muted small">
                <span>{t('dashboard.goalStart', { weight: fmtNum(goal.startWeight), unit })}</span>
                <span>{t('dashboard.goalEnd', { weight: fmtNum(goal.goalWeight), unit })}</span>
              </div>
            </>
          )}
        </div>
      ) : null,
    week: (
      <div className="card">
        <span className="overline">{t('dashboard.week')}</span>
        <div className="grid2" style={{ marginTop: 6 }}>
          <div className="stat">
            <b>{fmtEnergy(week.kcal, eu)}</b>
            <span>{t('dashboard.weekKcal', { unit: eu, target: fmtEnergy(week.targetKcal, eu) })}</span>
          </div>
          <div className="stat">
            <b>{fmtNum(week.protein, 0)} g</b>
            <span>{t('dashboard.weekProtein', { target: fmtNum(week.targetProtein, 0) })}</span>
          </div>
        </div>
        <div className="muted tiny" style={{ marginTop: 6 }}>
          {t('dashboard.weekLogged', { count: week.logged })}
        </div>
      </div>
    ),
    insights: (
      <div className="card">
        <span className="overline">{t('dashboard.insights')}</span>
        {energy ? (
          <>
            <div className="row between" style={{ marginTop: 6, alignItems: 'flex-end' }}>
              <div className="stat">
                <b className="num-xl">
                  <Ticker value={Math.abs(e(energy.balance) ?? 0)} /> <span className="small muted">{eu}</span>
                </b>
                <span>{energy.balance <= 0 ? t('dashboard.deficit') : t('dashboard.surplus')}</span>
              </div>
              <span className={`tag ${energy.balance <= 0 ? 'tag-live' : ''}`}>{t('dashboard.balanceDays', { count: energy.days })}</span>
            </div>
            <div className="grid2" style={{ marginTop: 10 }}>
              <div className="stat">
                <b>{fmtEnergy(energy.intake, eu)}</b>
                <span>{t('dashboard.avgIntake', { unit: eu })}</span>
              </div>
              <div className="stat">
                <b>{fmtEnergy(energy.expenditure, eu)}</b>
                <span>{t('dashboard.avgExpenditure', { unit: eu })}</span>
              </div>
              <div className="stat">
                <b>{impliedRate === undefined ? '–' : `${impliedRate > 0 ? '+' : ''}${fmtNum(impliedRate, 2)}`}</b>
                <span>{t('dashboard.impliedRate', { unit })}</span>
              </div>
              <div className="stat">
                <b>{a.ratePerWeek === undefined ? '–' : `${a.ratePerWeek > 0 ? '+' : ''}${fmtNum(a.ratePerWeek, 2)}`}</b>
                <span>{t('dashboard.trendRate', { unit })}</span>
              </div>
            </div>
            <div className="muted tiny" style={{ marginTop: 6 }}>
              {t('dashboard.insightsHint')}
            </div>
          </>
        ) : (
          <div className="muted small" style={{ padding: '8px 0' }}>
            {t('dashboard.insightsEmpty')}
          </div>
        )}
      </div>
    ),
    habits: (
      <div className="card">
        <span className="overline">{t('dashboard.habits')}</span>
        <div style={{ marginTop: 8 }}>
          <Seg
            value={habit}
            onChange={setHabit}
            options={[
              { value: 'food', label: t('dashboard.habitFood') },
              { value: 'weigh', label: t('dashboard.habitWeigh') },
            ]}
          />
        </div>
        <div className="grid3 habit-stats">
          <div className="stat">
            <b className="num">{stats.current}</b>
            <span>{t('dashboard.habitCurrent')}</span>
          </div>
          <div className="stat">
            <b className="num">{stats.best}</b>
            <span>{t('dashboard.habitBest')}</span>
          </div>
          <div className="stat">
            <b className="num">{weekDone}/7</b>
            <span>{t('dashboard.habitWeek')}</span>
          </div>
        </div>
        <div className="habit-cal" role="group" aria-label={t('dashboard.habitSummary', { done: habitDone, total: calendar.length })}>
          {weeks.map((w, i) => {
            const month = new Date(w[0].date + 'T00:00').toLocaleDateString(undefined, { month: 'short' });
            const prev = i > 0 ? new Date(weeks[i - 1][0].date + 'T00:00').toLocaleDateString(undefined, { month: 'short' }) : '';
            return month !== prev ? (
              <span key={`m${i}`} className="habit-month" style={{ gridColumn: i + 2, gridRow: 1 }}>
                {month}
              </span>
            ) : null;
          })}
          {narrowDays.map((d, i) =>
            i % 2 === 0 ? (
              <span key={`d${i}`} className="habit-day" style={{ gridColumn: 1, gridRow: i + 2 }} aria-hidden>
                {d}
              </span>
            ) : null,
          )}
          {weeks.flatMap((w, wi) =>
            w.map((d, di) =>
              d.future ? (
                <span key={d.date} className="habit-cell future" style={{ gridColumn: wi + 2, gridRow: di + 2 }} aria-hidden />
              ) : (
                <button
                  key={d.date}
                  className={`habit-cell${d.done ? ' on' : ''}${d.date === today ? ' today' : ''}`}
                  style={{ gridColumn: wi + 2, gridRow: di + 2 }}
                  aria-label={`${new Date(d.date + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${d.done ? t('dashboard.habitDone') : t('dashboard.habitMissed')}`}
                  onClick={() => (habit === 'food' ? nav(`/log/${d.date}`) : nav('/more/body'))}
                />
              ),
            ),
          )}
        </div>
        <div className="muted tiny" style={{ marginTop: 8 }}>
          {t('dashboard.habitSummary', { done: habitDone, total: calendar.length })}
          {goal && goal.style !== 'manual'
            ? ` · ${t('dashboard.nextCheckIn', { day: new Date(nextCheckIn(goal, today) + 'T00:00').toLocaleDateString(undefined, { weekday: 'long' }) })}`
            : ''}
        </div>
      </div>
    ),
  };

  const order = st.settings.dashboard.filter((c) => c.visible && cards[c.id]);
  const move = (i: number, d: -1 | 1) => {
    const arr = [...st.settings.dashboard];
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    st.setSettings({ dashboard: arr });
  };

  return (
    <Page
      title={t('dashboard.title')}
      actions={
        <button className="btn sm ghost" onClick={() => setCustomize(true)}>
          {t('dashboard.customize')}
        </button>
      }
    >
      <AnimatePresence>
        {due && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={motionTokens.base}>
            <Link to="/checkin" className="card accent checkin-card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Illustration scene="check-in" size={72} />
              <span className="grow">
                <b>{t('dashboard.checkinReady')}</b>
                <div className="muted small">{t('dashboard.checkinSub')}</div>
              </span>
              <span aria-hidden>›</span>
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
      {!goal && (
        <Link to="/goal" className="card accent" style={{ display: 'block' }}>
          <b>{t('dashboard.setGoal')}</b>
          <div className="muted small">{t('dashboard.setGoalSub')}</div>
        </Link>
      )}

      {order.map((c, i) => (
        <motion.section key={c.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionTokens.base, delay: stagger(i) }}>
          {c.id === 'expenditure' && (
            <div style={{ marginBottom: 12 }}>
              <Seg value={range} onChange={setRange} options={[{ value: 14, label: '2W' }, { value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 180, label: '6M' }, { value: 365, label: '1Y' }]} />
            </div>
          )}
          {cards[c.id]}
        </motion.section>
      ))}

      <WeighInSheet open={weighOpen} onClose={() => setWeighOpen(false)} />
      <Sheet open={customize} onClose={() => setCustomize(false)} title={t('dashboard.customizeTitle')}>
        <div className="list">
          {st.settings.dashboard.map((c, i) => (
            <div key={c.id} className="row" style={{ padding: '8px 0' }}>
              <span className="grow">{t(CARD_NAMES[c.id])}</span>
              <button className="icon-btn" aria-label={t('dashboard.moveUp', { name: t(CARD_NAMES[c.id]) })} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="icon-btn" aria-label={t('dashboard.moveDown', { name: t(CARD_NAMES[c.id]) })} onClick={() => move(i, 1)}>
                ↓
              </button>
              <Switch
                checked={c.visible}
                label={t('dashboard.showCard', { name: t(CARD_NAMES[c.id]) })}
                onChange={(v) => st.setSettings({ dashboard: st.settings.dashboard.map((x) => (x.id === c.id ? { ...x, visible: v } : x)) })}
              />
            </div>
          ))}
        </div>
      </Sheet>
    </Page>
  );
}
