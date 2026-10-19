import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Ticker } from '../ui/Ticker';
import { motionTokens } from '../ui/motion';
import { haptic } from '../platform/haptics';
import { NumField, Page, Seg } from '../components/ui';
import { buildSnapshot, fromKg } from '../domain/coach';
import { DIET_LABELS, PROTEIN_LABELS, RATE_PRESETS, WEEKDAYS, coachedTargets, goalDailyDelta, isMinor } from '../domain/targets';
import { t } from '../i18n';
import type { CalorieFloor, DietType, Goal, GoalType, MacroTarget, ProgramStyle, ProteinPref } from '../domain/types';
import { isoDate, uid } from '../domain/util';
import { useActiveGoal, useAnalysis, useStore } from '../store';

export default function GoalWizard() {
  const st = useStore();
  const existing = useActiveGoal();
  const a = useAnalysis();
  const nav = useNavigate();
  const unit = st.settings.weightUnit;
  const eu = st.settings.energyUnit;
  const current = Math.round(fromKg(a.currentWeightKg, unit) * 10) / 10;

  const [step, setStep] = useState(0);
  const [type, setType] = useState<GoalType>(existing?.type ?? 'lose');
  const [goalWeight, setGoalWeight] = useState<number | undefined>(existing?.goalWeight ?? Math.round(current * 0.9));
  const [rate, setRate] = useState(existing?.ratePct ?? 0.5);
  const [style, setStyle] = useState<ProgramStyle>(existing?.style ?? 'coached');
  const [diet, setDiet] = useState<DietType>(existing?.diet ?? 'balanced');
  const [protein, setProtein] = useState<ProteinPref>(existing?.protein ?? 'moderate');
  // "None" is no longer offered: older goals that used it continue on the low floor.
  const [floor, setFloor] = useState<CalorieFloor>(existing?.floor === 'none' ? 'low' : (existing?.floor ?? 'standard'));
  const minor = isMinor(st.profile);
  const [highDays, setHighDays] = useState<number[]>(existing?.highDays ?? []);
  const [highShift, setHighShift] = useState(existing?.highShift ?? 0.1);
  const [checkInDay, setCheckInDay] = useState(existing?.checkInDay ?? 0);
  const [manual, setManual] = useState<MacroTarget[] | undefined>(existing?.manual);
  const [goalId] = useState(uid);

  const goal: Goal = {
    id: goalId,
    type,
    startDate: isoDate(),
    startWeight: current,
    goalWeight: type === 'maintain' ? undefined : goalWeight,
    ratePct: type === 'maintain' ? 0 : rate,
    style,
    diet,
    protein,
    floor,
    highDays,
    highShift: highDays.length ? highShift : 0,
    checkInDay,
    manual,
  };
  const preview = useMemo(() => coachedTargets(goal, a.current, a.currentWeightKg, st.profile), [JSON.stringify(goal), a.current, a.currentWeightKg, st.profile]); // eslint-disable-line react-hooks/exhaustive-deps
  const weeklyChange = (goalDailyDelta(goal, a.currentWeightKg) * 7) / 7700;
  const weeks = goalWeight && weeklyChange ? Math.abs((goalWeight - current) / fromKg(weeklyChange, unit)) : undefined;
  const e = (k: number) => (eu === 'kJ' ? Math.round(k * 4.184) : k);

  const save = () => {
    const g = { ...goal, manual: style === 'manual' ? (manual ?? preview.targets) : undefined };
    st.startGoal(g, buildSnapshot(g, a, st.profile, isoDate()));
    haptic('success');
    nav('/strategy', { replace: true });
  };

  const steps = [
    <>
      <h2>What's your goal?</h2>
      <Seg
        value={type}
        onChange={setType}
        options={[
          { value: 'lose', label: 'Lose weight' },
          { value: 'maintain', label: 'Maintain' },
          { value: 'gain', label: 'Gain weight' },
        ]}
      />
      {type !== 'maintain' && (
        <>
          <label className="lbl">
            Goal weight ({unit}) · current trend {current} {unit}
          </label>
          <NumField value={goalWeight} step={0.5} onChange={setGoalWeight} />
          <label className="lbl">Rate (% of body weight per week)</label>
          <div className="chips">
            {RATE_PRESETS[type].filter((r) => !minor || type !== 'lose' || r.pct <= 0.5).map((r) => (
              <button key={r.pct} className={`chip ${rate === r.pct ? 'on' : ''}`} onClick={() => setRate(r.pct)}>
                {r.label} · {r.pct}%
              </button>
            ))}
          </div>
          <input type="range" min={0.05} max={type === 'lose' ? (minor ? 0.5 : 1.25) : 0.75} step={0.05} value={rate} onChange={(ev) => setRate(Number(ev.target.value))} style={{ width: '100%', marginTop: 8 }} aria-label="Rate" />
          {minor && <p className="small day-flag card tight">{t('goal.minorNote')}</p>}
          <div className="card small">
            {rate}% per week ≈ {Math.abs(Math.round(fromKg(weeklyChange, unit) * 100) / 100)} {unit}/week, {Math.abs(Math.round(goalDailyDelta(goal, a.currentWeightKg)))} kcal/day {type === 'lose' ? 'deficit' : 'surplus'}.
            {weeks && Number.isFinite(weeks) ? ` About ${Math.ceil(weeks)} weeks to reach ${goalWeight} ${unit}.` : ''}
          </div>
        </>
      )}
    </>,
    <>
      <h2>Program style</h2>
      {(
        [
          ['coached', 'Coached', 'Targets update automatically at each weekly check-in based on your expenditure.'],
          ['manual', 'Manual', 'You set calories and macros yourself. Expenditure is still tracked.'],
        ] as [ProgramStyle, string, string][]
      ).map(([v, t, d]) => (
        <button key={v} className={`card item ${style === v ? 'accent' : ''}`} style={{ padding: 14 }} onClick={() => setStyle(v)}>
          <span className="grow">
            <b>{t}</b>
            <div className="muted small">{d}</div>
          </span>
        </button>
      ))}
      <h2>Diet type</h2>
      {(Object.keys(DIET_LABELS) as DietType[]).map((d) => (
        <button key={d} className={`card item tight ${diet === d ? 'accent' : ''}`} onClick={() => setDiet(d)}>
          <span className="grow">
            <b>{DIET_LABELS[d].title}</b>
            <div className="muted small">{DIET_LABELS[d].desc}</div>
          </span>
        </button>
      ))}
      <label className="lbl">Protein</label>
      <Seg value={protein} onChange={setProtein} options={(Object.keys(PROTEIN_LABELS) as ProteinPref[]).map((p) => ({ value: p, label: PROTEIN_LABELS[p] }))} />
    </>,
    <>
      <h2>Calorie floor</h2>
      <Seg
        value={floor}
        onChange={setFloor}
        options={minor ? [{ value: 'standard', label: 'Standard' }] : [
          { value: 'standard', label: 'Standard' },
          { value: 'low', label: 'Low' },
        ]}
      />
      <p className="muted small">{t('goal.floorNote')}</p>
      <h2>Higher-calorie days</h2>
      <p className="muted small">Shift some of the week's calories to chosen days (e.g. weekends). The weekly total stays the same.</p>
      <div className="grid3" style={{ gridTemplateColumns: 'repeat(7,1fr)' }}>
        {WEEKDAYS.map((d, i) => (
          <button key={d} className={`chip ${highDays.includes(i) ? 'on' : ''}`} style={{ justifyContent: 'center' }} onClick={() => setHighDays(highDays.includes(i) ? highDays.filter((x) => x !== i) : [...highDays, i])}>
            {d.slice(0, 2)}
          </button>
        ))}
      </div>
      {highDays.length > 0 && (
        <>
          <label className="lbl">Share of weekly calories moved: {Math.round(highShift * 100)}%</label>
          <input type="range" min={0.05} max={0.3} step={0.05} value={highShift} onChange={(ev) => setHighShift(Number(ev.target.value))} style={{ width: '100%' }} aria-label="Shift" />
        </>
      )}
      <h2>Check-in day</h2>
      <select className="field" value={checkInDay} onChange={(ev) => setCheckInDay(Number(ev.target.value))}>
        {WEEKDAYS.map((d, i) => (
          <option key={d} value={i}>
            {d}
          </option>
        ))}
      </select>
    </>,
    <>
      <h2>Your plan</h2>
      <div className="card accent">
        <div className="grid3">
          <div className="stat">
            <b>
              <Ticker value={e(a.current)} />
            </b>
            <span>Expenditure ({eu})</span>
          </div>
          <div className="stat">
            <b>
              <Ticker value={e(preview.average)} />
            </b>
            <span>Avg target ({eu})</span>
          </div>
          <div className="stat">
            <b>{preview.targets[0].protein} g</b>
            <span>Protein</span>
          </div>
        </div>
        {preview.flooredBy ? <p className="small" style={{ marginBottom: 0 }}>Your calorie floor raised targets by {Math.round(preview.flooredBy)} kcal/day; progress will be slower than the chosen rate.</p> : null}
      </div>
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
          {(style === 'manual' ? (manual ?? preview.targets) : preview.targets).map((t, i) => (
            <motion.tr key={i} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ ...motionTokens.list, delay: 0.08 + i * 0.05 }}>
              <td>{WEEKDAYS[i].slice(0, 3)}</td>
              {style === 'manual' ? (
                (['protein', 'fat', 'carbs'] as const).reduce(
                  (cells, k) => [
                    ...cells,
                    <td key={k}>
                      <input
                        className="field"
                        style={{ width: 64, padding: '4px 6px', textAlign: 'right' }}
                        type="number"
                        aria-label={`${WEEKDAYS[i]} ${k}`}
                        value={t[k]}
                        onChange={(ev) => {
                          const base = manual ?? preview.targets;
                          const next = base.map((x, j) => {
                            if (j !== i) return x;
                            const y = { ...x, [k]: Number(ev.target.value) || 0 };
                            return { ...y, kcal: y.protein * 4 + y.carbs * 4 + y.fat * 9 };
                          });
                          setManual(next);
                        }}
                      />
                    </td>,
                  ],
                  [<td key="k">{e(t.kcal)}</td>],
                )
              ) : (
                <>
                  <td>{e(t.kcal)}</td>
                  <td>{t.protein}</td>
                  <td>{t.fat}</td>
                  <td>{t.carbs}</td>
                </>
              )}
            </motion.tr>
          ))}
        </tbody>
      </table>
      {style === 'manual' && <p className="muted tiny">Edit grams per day; calories follow from the macros.</p>}
    </>,
  ];

  return (
    <Page title={existing ? 'Edit goal' : 'New goal'} back={!!existing}>
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
          <button className="btn primary grow" disabled={type !== 'maintain' && step === 0 && !goalWeight} onClick={() => setStep(step + 1)}>
            Continue
          </button>
        ) : (
          <button className="btn primary grow" onClick={save}>
            {existing ? 'Start new goal' : 'Start goal'}
          </button>
        )}
      </div>
    </Page>
  );
}
