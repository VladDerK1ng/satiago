import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { NumField, Seg, Switch } from '../components/ui';
import { initialExpenditure, LB_PER_KG } from '../domain/expenditure';
import type { ActivityLevel, EnergyUnit, WeightUnit } from '../domain/types';
import { isoDate } from '../domain/util';
import { useStore } from '../store';
import { Illustration } from '../ui/Illustration';
import { Ticker } from '../ui/Ticker';

const ACTIVITY: { value: ActivityLevel; title: string; desc: string }[] = [
  { value: 'sedentary', title: 'Mostly sitting', desc: 'Desk work and not much walking on most days.' },
  { value: 'light', title: 'Light', desc: 'Some walking or standing during the day.' },
  { value: 'moderate', title: 'Moderate', desc: 'On your feet much of the day, or an active job.' },
  { value: 'very', title: 'Very active', desc: 'Physically demanding work most days.' },
];

export default function Onboarding() {
  const st = useStore();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [wu, setWu] = useState<WeightUnit>(st.settings.weightUnit);
  const [eu, setEu] = useState<EnergyUnit>(st.settings.energyUnit);
  const [p, setP] = useState(st.profile);
  // No default: a pre-filled number would be saved as a real weigh-in.
  const [weight, setWeight] = useState<number | undefined>();
  const [ftIn, setFtIn] = useState<[number, number]>([5, 10]);

  const kg = weight ? (wu === 'kg' ? weight : weight / LB_PER_KG) : 75;
  const estimate = initialExpenditure(p, kg);

  const finish = () => {
    st.setSettings({ weightUnit: wu, energyUnit: eu, onboarded: true });
    st.setProfile(p);
    if (weight) st.saveBody({ date: isoDate(), weight, bodyFat: p.bodyFat });
    nav('/goal', { replace: true });
  };

  return (
    <div style={{ paddingTop: 'calc(24px + var(--safe-top))' }}>
      <div className="tiny muted">Step {step + 1} of 3</div>
      {step === 0 && (
        <>
          <div style={{ display: 'grid', placeItems: 'center', margin: '8px 0 4px' }}>
            <Illustration scene="welcome" size={220} />
          </div>
          <h1 className="display">A nutrition coach that learns your metabolism</h1>
          <p className="muted">
            Log what you eat and weigh in. Satiago estimates how much energy you really burn and adjusts your targets each week. Everything stays on this device.
          </p>
          <label className="lbl">Weight unit</label>
          <Seg value={wu} onChange={setWu} options={[{ value: 'kg', label: 'Kilograms' }, { value: 'lb', label: 'Pounds' }]} />
          <label className="lbl">Energy unit</label>
          <Seg value={eu} onChange={setEu} options={[{ value: 'kcal', label: 'Calories (kcal)' }, { value: 'kJ', label: 'Kilojoules' }]} />
          <button className="btn primary block" style={{ marginTop: 20 }} onClick={() => setStep(1)}>
            Continue
          </button>
          <button
            className="btn ghost block"
            style={{ marginTop: 8 }}
            onClick={() => {
              // Profile, goal and weigh-ins come from the import, so the questions can be skipped.
              st.setSettings({ weightUnit: wu, energyUnit: eu, onboarded: true });
              nav('/more/data', { replace: true });
            }}
          >
            {t('onboarding.importMacroFactor')}
          </button>
        </>
      )}
      {step === 1 && (
        <>
          <h1>About you</h1>
          <p className="muted small">{t('onboarding.notMedical')}</p>
          <label className="lbl">Sex (for metabolic equations)</label>
          <Seg value={p.sex} onChange={(sex) => setP({ ...p, sex })} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />
          <div className="grid2">
            <div>
              <label className="lbl">Birth year</label>
              <NumField value={p.birthYear} onChange={(v) => setP({ ...p, birthYear: v ?? 1990 })} />
            </div>
            <div>
              <label className="lbl">Weight ({wu})</label>
              <NumField value={weight} step={0.1} onChange={setWeight} placeholder={wu === 'kg' ? 'e.g. 75' : 'e.g. 165'} ariaLabel={`Weight (${wu})`} />
            </div>
          </div>
          <label className="lbl">Height</label>
          {wu === 'kg' ? (
            <NumField value={p.heightCm} onChange={(v) => setP({ ...p, heightCm: v ?? 170 })} placeholder="cm" ariaLabel="Height in cm" />
          ) : (
            <div className="grid2">
              <NumField value={ftIn[0]} ariaLabel="Feet" onChange={(v) => { const x: [number, number] = [v ?? 5, ftIn[1]]; setFtIn(x); setP({ ...p, heightCm: Math.round((x[0] * 12 + x[1]) * 2.54) }); }} />
              <NumField value={ftIn[1]} ariaLabel="Inches" onChange={(v) => { const x: [number, number] = [ftIn[0], v ?? 0]; setFtIn(x); setP({ ...p, heightCm: Math.round((x[0] * 12 + x[1]) * 2.54) }); }} />
            </div>
          )}
          {new Date().getFullYear() - p.birthYear < 18 && <p className="small day-flag card tight">{t('onboarding.minor')}</p>}
          <label className="lbl">Body fat % (optional, improves accuracy)</label>
          <NumField value={p.bodyFat} step={0.5} onChange={(v) => setP({ ...p, bodyFat: v })} placeholder="e.g. 20" />
          <div className="row">
            <button className="btn grow" onClick={() => setStep(0)}>
              Back
            </button>
            <button className="btn primary grow" style={{ marginTop: 16 }} disabled={!weight || weight <= 0} onClick={() => setStep(2)}>
              Continue
            </button>
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <h1>Daily activity</h1>
          <p className="muted small">Outside of planned exercise, during work and leisure.</p>
          {ACTIVITY.map((a) => (
            <button key={a.value} className={`card item ${p.activity === a.value ? 'accent' : ''}`} style={{ padding: 14 }} onClick={() => setP({ ...p, activity: a.value })}>
              <span className="grow">
                <b>{a.title}</b>
                <div className="muted small">{a.desc}</div>
              </span>
            </button>
          ))}
          <div className="card row">
            <span className="grow">I train hard enough to consider myself an athlete</span>
            <Switch checked={p.athlete} onChange={(athlete) => setP({ ...p, athlete })} label="Athlete" />
          </div>
          <div className="card accent">
            <div className="tiny muted">Starting expenditure estimate</div>
            <b className="num-xl">
              <Ticker value={eu === 'kJ' ? Math.round(estimate * 4.184) : estimate} />
            </b>{' '}
            {eu}/day
            <p className="muted small" style={{ marginBottom: 0 }}>
              This comes from a resting-energy equation and your activity level. It is refined from your own food and weight data, with the first update after 3 days of logging.
            </p>
          </div>
          <button className="btn primary block" onClick={finish}>
            Set my goal
          </button>
        </>
      )}
    </div>
  );
}
