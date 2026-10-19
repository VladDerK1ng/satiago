import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Seg } from '../components/ui';
import { bodyRatios, fromCm, latestMeasurements, measurementSeries, toCm } from '../domain/body';
import { MEASUREMENT_KEYS, type BodyEntry, type MeasurementKey } from '../domain/types';
import { fmtNum, isoDate } from '../domain/util';
import { t } from '../i18n';
import { haptic } from '../platform/haptics';
import { useStore } from '../store';
import { toast } from '../ui/snackbar';

const DAY_MS = 86400000;
const tooltipStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 12, color: 'var(--color-text)' };
const tick = { fontSize: 10, fill: 'var(--color-text-muted)' };
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const parseNum = (s: string) => {
  const v = Number(s.trim().replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(v) && v > 0 ? v : undefined;
};

/** Tape measurements: log several sites for a day, see ratios and the history of one site. */
export function BodyMeasurements({ range, ranges, onRange }: { range: number; ranges: { value: number; label: string }[]; onRange: (r: number) => void }) {
  const body = useStore((s) => s.body);
  const unit = useStore((s) => s.settings.lengthUnit);
  const heightCm = useStore((s) => s.profile.heightCm);
  const saveBody = useStore((s) => s.saveBody);
  const [date, setDate] = useState(isoDate());
  const [raw, setRaw] = useState<Partial<Record<MeasurementKey, string>>>({});
  // What the form showed for the day; untouched sites are not re-saved (avoids cm/in rounding drift).
  const [shown, setShown] = useState<Partial<Record<MeasurementKey, string>>>({});
  const [site, setSite] = useState<MeasurementKey>('waist');

  // Editing a day starts from what was already measured that day.
  const day = body.find((b) => b.date === date);
  useEffect(() => {
    const m = day?.measurements ?? {};
    const values = Object.fromEntries(MEASUREMENT_KEYS.filter((k) => m[k]).map((k) => [k, fmtNum(fromCm(m[k]!, unit), 1)]));
    setRaw(values);
    setShown(values);
  }, [date, day?.measurements, unit]);

  const latest = useMemo(() => latestMeasurements(body), [body]);
  const ratios = bodyRatios(latest, heightCm);
  const cutoff = isoDate(Date.now() - range * DAY_MS);
  const series = useMemo(
    () => measurementSeries(body, site).filter((p) => p.date >= cutoff).map((p) => ({ date: p.date, value: Math.round(fromCm(p.cm, unit) * 10) / 10 })),
    [body, site, cutoff, unit],
  );
  const history = useMemo(() => [...body].filter((b) => b.measurements && Object.values(b.measurements).some((v) => v)).reverse().slice(0, 60), [body]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const measurements: Partial<Record<MeasurementKey, number>> = {};
    for (const k of MEASUREMENT_KEYS) {
      if ((raw[k] ?? '') === (shown[k] ?? '')) continue;
      const v = parseNum(raw[k] ?? '');
      // Cleared fields remove that day's value.
      measurements[k] = v === undefined ? undefined : Math.round(toCm(v, unit) * 10) / 10;
    }
    if (!Object.keys(measurements).length) return toast(t('body.tape.noChanges'));
    if (!Object.values(measurements).some((v) => v !== undefined) && !day?.measurements) {
      haptic('warning');
      toast(t('body.invalid'));
      return;
    }
    saveBody({ date, measurements });
    haptic('add');
    toast(t('body.tape.saved', { date: fmtDate(date) }));
  };

  const removeDay = (b: BodyEntry) => {
    const prev = b.measurements;
    saveBody({ date: b.date, measurements: Object.fromEntries(MEASUREMENT_KEYS.map((k) => [k, undefined])) });
    haptic('warning');
    toast(t('body.entryDeleted'), { label: t('common.undo'), run: () => saveBody({ date: b.date, measurements: prev }) });
  };

  const siteName = (k: MeasurementKey) => t(`body.tape.${k}`);

  return (
    <>
      <form className="card" style={{ marginTop: 'var(--space-3)' }} onSubmit={save}>
        <label className="lbl" htmlFor="tape-date">
          {t('body.date')}
        </label>
        <input id="tape-date" className="field num" type="date" value={date} max={isoDate()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <div className="grid2 fw-tape-grid">
          {MEASUREMENT_KEYS.map((k) => (
            <div key={k}>
              <label className="lbl" htmlFor={`tape-${k}`}>
                {siteName(k)} ({unit})
              </label>
              <input
                id={`tape-${k}`}
                className="field num"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={raw[k] ?? ''}
                placeholder={latest[k] ? fmtNum(fromCm(latest[k]!.cm, unit), 1) : ''}
                onChange={(e) => setRaw((r) => ({ ...r, [k]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <button className="btn primary block" style={{ marginTop: 'var(--space-3)' }} type="submit">
          {t('body.tape.save')}
        </button>
      </form>

      <h2>{t('body.tape.ratios')}</h2>
      <div className="card">
        <div className="fw-stats">
          <div className="stat">
            <b className="fw-stat-value num">{ratios.waistToHeight !== undefined ? fmtNum(ratios.waistToHeight, 2) : '–'}</b>
            <span>{t('body.tape.waistToHeight')}</span>
          </div>
          <div className="stat">
            <b className="fw-stat-value num">{ratios.waistToHip !== undefined ? fmtNum(ratios.waistToHip, 2) : '–'}</b>
            <span>{t('body.tape.waistToHip')}</span>
          </div>
        </div>
        <p className="fw-note">{ratios.waistToHeight === undefined ? t('body.tape.ratiosEmpty') : t('body.tape.ratiosNote')}</p>
      </div>

      <h2>{t('body.tape.history')}</h2>
      <div className="card">
        <select className="field" aria-label={t('body.tape.site')} value={site} onChange={(e) => setSite(e.target.value as MeasurementKey)}>
          {MEASUREMENT_KEYS.map((k) => (
            <option key={k} value={k}>
              {siteName(k)}
              {latest[k] ? ` · ${fmtNum(fromCm(latest[k]!.cm, unit), 1)} ${unit}` : ''}
            </option>
          ))}
        </select>
        <div role="img" aria-label={t('body.chartSeries', { name: siteName(site), count: series.length })}>
          {series.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={series} margin={{ left: -10, right: 6, top: 12 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="date" tick={tick} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis domain={['auto', 'auto']} tick={tick} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line dataKey="value" name={`${siteName(site)} (${unit})`} stroke="var(--color-accent)" strokeWidth={2.5} dot={{ r: 2.5 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="fw-note">{t('body.tape.noSite', { site: siteName(site) })}</p>
          )}
        </div>
        <div role="group" aria-label={t('body.range')}>
          <Seg value={range} onChange={onRange} options={ranges} />
        </div>
      </div>

      <h2>{t('body.entries')}</h2>
      <div className="card list tight">
        {history.length === 0 && <p className="fw-note">{t('body.noEntries')}</p>}
        {history.map((b) => (
          <div key={b.date} className="fw-entry">
            <button className="grow fw-entry-open" onClick={() => setDate(b.date)}>
              <span>{fmtDate(b.date)}</span>
              <span className="fw-note" style={{ margin: 0 }}>
                {MEASUREMENT_KEYS.filter((k) => b.measurements?.[k])
                  .map((k) => `${siteName(k)} ${fmtNum(fromCm(b.measurements![k]!, unit), 1)}`)
                  .join(' · ')}
              </span>
            </button>
            <button className="icon-btn" aria-label={t('body.deleteEntry', { date: fmtDate(b.date) })} onClick={() => removeDay(b)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
