import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, NumField, Page, Switch } from '../components/ui';
import { analyze, buildSnapshot, snapshotFor } from '../domain/coach';
import { dayTotals, fmtEnergy } from '../domain/nutrition';
import { coachedTargets, WEEKDAYS } from '../domain/targets';
import { dayIndex, fromIndex } from '../domain/trend';
import type { MacroTarget } from '../domain/types';
import { fmtNum, isoDate } from '../domain/util';
import { t } from '../i18n';
import { haptic } from '../platform/haptics';
import { useActiveGoal, useStore } from '../store';
import { Illustration } from '../ui/Illustration';
import { toast } from '../ui/snackbar';

const avgKcal = (t: MacroTarget[]) => Math.round(t.reduce((s, x) => s + x.kcal, 0) / t.length);

/** Weekly check-in: weigh-in, logging review, then a program update. */
export default function CheckIn() {
  const st = useStore();
  const goal = useActiveGoal();
  const nav = useNavigate();
  const today = isoDate();
  const unit = st.settings.weightUnit;
  const eu = st.settings.energyUnit;
  const [step, setStep] = useState(0);
  const [weight, setWeight] = useState<number | undefined>(st.body.find((b) => b.date === today)?.weight);
  const [adjust, setAdjust] = useState(0);

  const week = Array.from({ length: 7 }, (_, i) => fromIndex(dayIndex(today) - 7 + i));
  const previous = goal ? snapshotFor(today, st.snapshots.filter((s) => s.goalId === goal.id)) : undefined;

  // Recompute with the latest weigh-in and day flags (the store updates as the user edits).
  const analysis = useMemo(
    () =>
      analyze({
        log: st.log,
        meta: st.meta,
        body: st.body,
        profile: st.profile,
        unit,
        trendAlpha: st.settings.trendAlpha,
        today,
        fallbackWeight: goal?.startWeight ?? 75,
      }),
    [st.log, st.meta, st.body, st.profile, unit, st.settings.trendAlpha, today, goal?.startWeight],
  );

  if (!goal)
    return (
      <Page title="Check-in" back>
        <Empty icon="🎯" title="No active goal">
          <button className="btn primary" onClick={() => nav('/goal')}>
            Set a goal
          </button>
        </Empty>
      </Page>
    );

  const snap = buildSnapshot(goal, analysis, st.profile, today, previous);
  // Collaborative tweak: shift average calories by ±10 % while keeping protein.
  const tweaked = adjust
    ? coachedTargets(goal, analysis.current * (1 + adjust / 100), analysis.currentWeightKg, st.profile, analysis.kcalPerKg).targets
    : snap.targets;
  const firstTrend = analysis.trend.find((t) => t.date >= week[0]);
  const lastTrend = analysis.trend.at(-1);

  const finish = () => {
    st.addSnapshot({ ...snap, targets: tweaked, reason: adjust ? `${snap.reason} Adjusted ${adjust > 0 ? '+' : ''}${adjust}% by you.` : snap.reason });
    haptic('success');
    toast(t('checkin.applied'));
    nav('/strategy', { replace: true });
  };

  const steps = [
    <>
      <div style={{ display: 'grid', placeItems: 'center', margin: '4px 0 8px' }}>
        <Illustration scene="check-in" size={160} />
      </div>
      <h2>Weigh-in</h2>
      <p className="muted small">Recent scale weight helps the coach give accurate recommendations. Weigh in under similar conditions each time.</p>
      <div className="row">
        <NumField value={weight} step={0.1} onChange={setWeight} placeholder={unit} ariaLabel={`Weight in ${unit}`} />
        <button className="btn primary" disabled={!weight} onClick={() => weight && st.saveBody({ date: today, weight })}>
          Save
        </button>
      </div>
      <p className="muted tiny">You can skip this step if you already weighed in recently.</p>
    </>,
    <>
      <h2>Review your logging</h2>
      <p className="muted small">
        Mark days you didn't log completely so they don't distort your expenditure. Mark empty days where you intentionally fasted.
      </p>
      <div className="card list tight">
        {week.map((d) => {
          const items = st.log.filter((x) => x.date === d);
          const kcal = dayTotals(items).kcal ?? 0;
          const m = st.meta.find((x) => x.date === d);
          const tgt = previous?.targets[(new Date(d + 'T00:00').getDay() + 6) % 7]?.kcal;
          const suspicious = !!tgt && items.length > 0 && kcal < tgt * 0.5 && !m?.partial;
          return (
            <div key={d} style={{ padding: '8px 0' }}>
              <div className="row between">
                <b className="small">{new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</b>
                <span className="small">{items.length ? `${fmtEnergy(kcal, eu)} ${eu}` : m?.fasted ? 'Fasted' : 'Not logged'}</span>
              </div>
              {suspicious && <div className="tiny" style={{ color: 'var(--warn)' }}>Much lower than target. Partially logged?</div>}
              <div className="row" style={{ gap: 14, marginTop: 4 }}>
                <span className="row tiny">
                  <Switch checked={!!m?.partial} label="Partial" onChange={(v) => st.setMeta(d, { partial: v, fasted: v ? false : m?.fasted })} /> Partial
                </span>
                {!items.length && (
                  <span className="row tiny">
                    <Switch checked={!!m?.fasted} label="Fasted" onChange={(v) => st.setMeta(d, { fasted: v, partial: v ? false : m?.partial })} /> Fasted
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>,
    <>
      <h2>Program update</h2>
      <div className="grid2">
        <div className="card stat">
          <span>Expenditure</span>
          <b>
            {fmtEnergy(analysis.current, eu)} {eu}
          </b>
          <span>{previous ? `${analysis.current - previous.expenditure >= 0 ? '+' : ''}${fmtEnergy(analysis.current - previous.expenditure, eu)} since last` : 'first check-in'}</span>
        </div>
        <div className="card stat">
          <span>Trend weight</span>
          <b>
            {fmtNum(lastTrend?.trend)} {unit}
          </b>
          <span>
            {firstTrend && lastTrend ? `${lastTrend.trend - firstTrend.trend >= 0 ? '+' : ''}${fmtNum(lastTrend.trend - firstTrend.trend, 2)} this week` : ''}
          </span>
        </div>
      </div>
      <div className="card small">{snap.reason}</div>
      <table className="wk">
        <thead>
          <tr>
            <th>Day</th>
            <th>Old</th>
            <th>New {eu}</th>
            <th>P</th>
            <th>F</th>
            <th>C</th>
          </tr>
        </thead>
        <tbody>
          {tweaked.map((t, i) => (
            <tr key={i}>
              <td>{WEEKDAYS[i].slice(0, 3)}</td>
              <td className="muted">{previous ? fmtEnergy(previous.targets[i].kcal, eu) : '–'}</td>
              <td>
                <b>{fmtEnergy(t.kcal, eu)}</b>
              </td>
              <td>{t.protein}</td>
              <td>{t.fat}</td>
              <td>{t.carbs}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="lbl">Adjust energy ({adjust > 0 ? '+' : ''}{adjust}%) · average {fmtEnergy(avgKcal(tweaked), eu)} {eu}</label>
      <input type="range" min={-10} max={10} step={1} value={adjust} onChange={(e) => setAdjust(Number(e.target.value))} style={{ width: '100%' }} aria-label="Adjust calories" />
    </>,
  ];

  return (
    <Page title={t('checkin.title')} back>
      <div className="progress" style={{ marginBottom: 8 }}>
        <div style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
      </div>
      {steps[step]}
      <div className="row" style={{ marginTop: 20 }}>
        {step > 0 && (
          <button className="btn grow" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step < steps.length - 1 ? (
          <button className="btn primary grow" onClick={() => setStep(step + 1)}>
            Continue
          </button>
        ) : (
          <button className="btn primary grow" onClick={finish}>
            {t('checkin.apply')}
          </button>
        )}
      </div>
    </Page>
  );
}
