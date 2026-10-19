import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Page, confirmDo } from '../components/ui';
import { checkInDue, nextCheckIn, snapshotFor, targetFor } from '../domain/coach';
import { fmtEnergy } from '../domain/nutrition';
import { DIET_LABELS, PROTEIN_LABELS, WEEKDAYS, weekdayOf } from '../domain/targets';
import { isoDate } from '../domain/util';
import { useActiveGoal, useAnalysis, useStore } from '../store';
import { tooltipStyle } from './Dashboard';
import { EmptyState } from '../ui/Illustration';
import { Ticker } from '../ui/Ticker';

export default function Strategy() {
  const st = useStore();
  const goal = useActiveGoal();
  const a = useAnalysis();
  const nav = useNavigate();
  const today = isoDate();
  const eu = st.settings.energyUnit;
  const unit = st.settings.weightUnit;

  if (!goal)
    return (
      <Page title="Plan">
        <EmptyState scene="goal-reached" title="No active goal">
          <p className="muted small">Pick a goal to get calorie and macro targets that adapt to your metabolism.</p>
          <button className="btn primary" onClick={() => nav('/goal')}>
            Set a goal
          </button>
        </EmptyState>
        <PastGoals />
      </Page>
    );

  const snaps = st.snapshots.filter((s) => s.goalId === goal.id).sort((x, y) => y.date.localeCompare(x.date));
  const current = snapshotFor(today, snaps);
  const targets = goal.style === 'manual' ? goal.manual : current?.targets;
  const due = checkInDue(goal, st.snapshots, today);
  const expSeries = a.expenditure.slice(-90).map((p) => ({ date: p.date.slice(5), expenditure: eu === 'kJ' ? Math.round(p.expenditure * 4.184) : p.expenditure }));
  const todayTarget = targetFor(today, goal, st.snapshots);

  return (
    <Page title="Plan">
      <div className="card accent">
        <div className="row between">
          <div>
            <div className="tiny muted">{goal.style === 'manual' ? 'Manual program' : 'Coached program'}</div>
            <h3 style={{ margin: '2px 0' }}>
              {goal.type === 'lose' ? 'Lose weight' : goal.type === 'gain' ? 'Gain weight' : 'Maintain weight'}
              {goal.goalWeight ? ` → ${goal.goalWeight} ${unit}` : ''}
            </h3>
            <div className="muted small">
              {goal.type !== 'maintain' ? `${goal.ratePct}%/week · ` : ''}
              {DIET_LABELS[goal.diet].title} · {PROTEIN_LABELS[goal.protein]} protein · since {goal.startDate}
            </div>
          </div>
          <button className="btn sm" onClick={() => nav('/goal')}>
            Edit
          </button>
        </div>
        {goal.style !== 'manual' && (
          <div className="row between" style={{ marginTop: 12 }}>
            <span className="small">
              Next check-in: <b>{WEEKDAYS[goal.checkInDay]}</b> ({nextCheckIn(goal, today)})
            </span>
            <button className={`btn sm ${due ? 'primary' : ''}`} onClick={() => nav('/checkin')}>
              {due ? 'Check in now' : 'Early check-in'}
            </button>
          </div>
        )}
      </div>

      <h2>Targets</h2>
      {targets ? (
        <div className="card">
          <table className="wk">
            <thead>
              <tr>
                <th>Day</th>
                <th>{eu}</th>
                <th>Protein</th>
                <th>Fat</th>
                <th>Carbs</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t, i) => (
                <tr key={i} style={i === weekdayOf(today) ? { fontWeight: 700 } : undefined}>
                  <td>{WEEKDAYS[i].slice(0, 3)}</td>
                  <td>{fmtEnergy(t.kcal, eu)}</td>
                  <td>{t.protein} g</td>
                  <td>{t.fat} g</td>
                  <td>{t.carbs} g</td>
                </tr>
              ))}
            </tbody>
          </table>
          {current && goal.style !== 'manual' && <p className="muted small" style={{ marginBottom: 0 }}>{current.reason}</p>}
        </div>
      ) : (
        <div className="card muted small">No targets yet. Run a check-in.</div>
      )}

      <h2>Expenditure</h2>
      <div className="card">
        <div className="row between">
          <div className="stat">
            <span>Current</span>
            <b className="num-xl">
              <Ticker value={eu === 'kJ' ? Math.round(a.current * 4.184) : a.current} /> <span className="small muted">{eu}</span>
            </b>
          </div>
          <div className="stat" style={{ textAlign: 'right' }}>
            <span>Initial estimate</span>
            <b>
              {fmtEnergy(a.initial, eu)} {eu}
            </b>
          </div>
        </div>
        {expSeries.length > 1 && (
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={expSeries} margin={{ left: -10, right: 4, top: 10 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} minTickGap={20} />
              <YAxis domain={['dataMin - 100', 'dataMax + 100']} tick={{ fontSize: 10, fill: 'var(--muted)' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line dataKey="expenditure" stroke="var(--color-expenditure)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>
          Estimated from your logged intake and weight trend. For uninterrupted updates, weigh in at least once a week and mark partially logged days.
        </p>
      </div>

      {todayTarget && (
        <div className="card small">
          Today's target: <b>{fmtEnergy(todayTarget.kcal, eu)} {eu}</b> · P {todayTarget.protein} · F {todayTarget.fat} · C {todayTarget.carbs}
        </div>
      )}

      <h2>Check-in history</h2>
      {snaps.length === 0 && <div className="muted small">None yet.</div>}
      {snaps.map((s) => (
        <div key={s.date} className="card tight">
          <div className="row between small">
            <b>{s.date}</b>
            <span>
              {fmtEnergy(Math.round(s.targets.reduce((t, x) => t + x.kcal, 0) / 7), eu)} {eu} avg · expenditure {fmtEnergy(s.expenditure, eu)}
            </span>
          </div>
          <div className="muted tiny">{s.reason}</div>
        </div>
      ))}
      <button className="btn danger block" style={{ marginTop: 12 }} onClick={() => confirmDo('End this goal? Your history is kept.', () => st.endGoal(goal.id))}>
        End goal
      </button>
      <PastGoals />
    </Page>
  );
}

function PastGoals() {
  const all = useStore((s) => s.goals);
  const goals = useMemo(() => all.filter((g) => g.endedAt), [all]);
  const unit = useStore((s) => s.settings.weightUnit);
  if (!goals.length) return null;
  return (
    <>
      <h2>Past goals</h2>
      {goals.map((g) => (
        <div key={g.id} className="card tight small">
          <b>{g.type === 'lose' ? 'Lose' : g.type === 'gain' ? 'Gain' : 'Maintain'}</b> · {g.startDate} → {g.endedAt} · start {g.startWeight} {unit}
          {g.goalWeight ? `, goal ${g.goalWeight} ${unit}` : ''}
        </div>
      ))}
    </>
  );
}
