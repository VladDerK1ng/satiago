import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, NumField, Page, Switch } from '../components/ui';
import { buildSnapshot, intakeDays, snapshotFor } from '../domain/coach';
import { dayTotals, fmtEnergy } from '../domain/nutrition';
import { WEEKDAYS } from '../domain/targets';
import { dayIndex, fromIndex } from '../domain/trend';
import { fmtNum, isoDate } from '../domain/util';
import { t } from '../i18n';
import { haptic } from '../platform/haptics';
import { useActiveGoal, useAnalysis, useStore } from '../store';
import { Illustration } from '../ui/Illustration';
import { toast } from '../ui/snackbar';

/**
 * Weekly check-in: weigh-in, logging review, then the program update. Targets also update by themselves
 * on the check-in day (see useAutoCheckIn); this screen is for a fresh weigh-in and a look at the week.
 */
export default function CheckIn() {
  const st = useStore();
  const goal = useActiveGoal();
  const nav = useNavigate();
  const today = isoDate();
  const unit = st.settings.weightUnit;
  const eu = st.settings.energyUnit;
  const [step, setStep] = useState(0);
  const [weight, setWeight] = useState<number | undefined>(st.body.find((b) => b.date === today)?.weight);

  const week = Array.from({ length: 7 }, (_, i) => fromIndex(dayIndex(today) - 7 + i));
  const previous = goal ? snapshotFor(today, st.snapshots.filter((s) => s.goalId === goal.id)) : undefined;

  // The same analysis as the dashboard; it updates with the weigh-in and day flags as the user edits them.
  const analysis = useAnalysis(today);
  const autoPartial = useMemo(() => new Set(intakeDays(st.log, st.meta).filter((d) => d.autoPartial).map((d) => d.date)), [st.log, st.meta]);

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
  const firstTrend = analysis.trend.find((t) => t.date >= week[0]);
  const lastTrend = analysis.trend.at(-1);

  const finish = () => {
    st.addSnapshot(snap);
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
      <p className="muted small">{t('checkin.reviewNote')}</p>
      <div className="card list tight">
        {week.map((d) => {
          const items = st.log.filter((x) => x.date === d);
          const kcal = dayTotals(items).kcal ?? 0;
          const m = st.meta.find((x) => x.date === d);
          const auto = autoPartial.has(d);
          return (
            <div key={d} style={{ padding: '8px 0' }}>
              <div className="row between">
                <b className="small">{new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</b>
                <span className="small">{items.length ? `${fmtEnergy(kcal, eu)} ${eu}` : m?.fasted ? 'Fasted' : 'Not logged'}</span>
              </div>
              {auto && <div className="tiny" style={{ color: 'var(--warn)' }}>{t('checkin.autoPartial')}</div>}
              <div className="row" style={{ gap: 14, marginTop: 4 }}>
                <span className="row tiny">
                  <Switch checked={m?.partial ?? auto} label="Partial" onChange={(v) => st.setMeta(d, { partial: v, fasted: v ? false : m?.fasted })} /> Partial
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
          {snap.targets.map((t, i) => (
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
