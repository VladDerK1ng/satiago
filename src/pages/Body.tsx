import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Page, Seg, Sheet, Switch } from '../components/ui';
import { periodRanges, cycleInfo } from '../domain/body';
import type { BodyEntry, ProgressPhoto } from '../domain/types';
import { fmtNum, isoDate, uid } from '../domain/util';
import { t } from '../i18n';
import { downscale, pickPhoto } from '../platform/camera';
import { haptic } from '../platform/haptics';
import { useAnalysis, useStore } from '../store';
import { EmptyState } from '../ui/Illustration';
import { toast } from '../ui/snackbar';
import { Ticker } from '../ui/Ticker';
import '../styles/settings.css';
import { BodyMeasurements } from './BodyMeasurements';

type Tab = 'weight' | 'bodyFat' | 'steps' | 'tape' | 'photos';
type Field = 'weight' | 'bodyFat' | 'steps';
const RANGES = [
  { value: 30, label: '1M' },
  { value: 90, label: '3M' },
  { value: 180, label: '6M' },
  { value: 365, label: '1Y' },
  { value: 100000, label: t('body.rangeAll') },
];
const DAY_MS = 86400000;
const tooltipStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 12, color: 'var(--color-text)' };
const tick = { fontSize: 10, fill: 'var(--color-text-muted)' };

const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtShort = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const signed = (n: number, digits = 1) => `${n > 0 ? '+' : ''}${fmtNum(n, digits)}`;
const poseLabel = (p: ProgressPhoto['pose']) => t(`body.pose.${p}`);
const parseNum = (s: string) => {
  const v = Number(s.trim().replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(v) ? v : undefined;
};

/** Progress photo from IndexedDB (`photo:<id>`, AD-3). Shows a placeholder while loading or when missing. */
function PhotoImg({ id, alt }: { id: string; alt: string }) {
  const [url, setUrl] = useState<string | null>();
  useEffect(() => {
    let live = true;
    let u: string | undefined;
    idbGet<Blob>(`photo:${id}`)
      .then((b) => {
        if (!live) return;
        if (b) setUrl((u = URL.createObjectURL(b)));
        else setUrl(null);
      })
      .catch(() => live && setUrl(null));
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  if (url) return <img className="fw-photo-img" src={url} alt={alt} />;
  return <div className={`fw-photo-img${url === null ? ' missing' : ''}`} role="img" aria-label={url === null ? t('body.photo.missing') : alt} />;
}

export default function Body() {
  const body = useStore((s) => s.body);
  const photos = useStore((s) => s.photos);
  const unit = useStore((s) => s.settings.weightUnit);
  const periodTracking = useStore((s) => s.settings.periodTracking);
  const saveBody = useStore((s) => s.saveBody);
  const addPhotoMeta = useStore((s) => s.addPhoto);
  const deletePhotoMeta = useStore((s) => s.deletePhoto);
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('weight');
  const [range, setRange] = useState(90);
  const [date, setDate] = useState(isoDate());
  const [raw, setRaw] = useState('');
  const [pose, setPose] = useState<ProgressPhoto['pose']>('front');
  const [compare, setCompare] = useState<string[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const valueRef = useRef<HTMLInputElement>(null);
  const focusPending = useRef(false);

  // Launcher shortcut / weigh-in reminder: /more/body?weigh=1 opens the weight tab ready to type.
  const weigh = params.get('weigh') === '1';
  useEffect(() => {
    if (!weigh) return;
    setTab('weight');
    setDate(isoDate());
    focusPending.current = true;
    setParams(
      (p) => {
        p.delete('weigh');
        return p;
      },
      { replace: true },
    );
  }, [weigh, setParams]);
  useEffect(() => {
    if (focusPending.current && tab === 'weight' && valueRef.current) {
      focusPending.current = false;
      valueRef.current.focus();
    }
  });

  const cutoff = isoDate(Date.now() - range * DAY_MS);
  const analysis = useAnalysis();
  const trend = useMemo(() => analysis.trend.filter((p) => p.date >= cutoff), [analysis.trend, cutoff]);
  const field: Field = tab === 'photos' || tab === 'tape' ? 'weight' : tab;
  const periods = useMemo(() => (periodTracking ? periodRanges(body).filter((r) => r.to >= cutoff) : []), [periodTracking, body, cutoff]);
  const cycle = useMemo(() => (periodTracking ? cycleInfo(body, isoDate()) : undefined), [periodTracking, body]);
  const onPeriod = !!body.find((b) => b.date === date)?.period;
  const series = useMemo(() => body.filter((b) => b.date >= cutoff && b[field] !== undefined), [body, cutoff, field]);
  const unitLabel = field === 'weight' ? unit : field === 'bodyFat' ? t('body.unit.percent') : t('body.unit.steps');
  const tabName = t(`body.tab.${field}`);

  const last = trend.at(-1);
  const change = trend.length > 1 ? trend[trend.length - 1].trend - trend[0].trend : 0;
  const weeks = trend.length > 1 ? (new Date(trend[trend.length - 1].date).getTime() - new Date(trend[0].date).getTime()) / (7 * DAY_MS) : 0;
  const value = parseNum(raw);
  const valid = value !== undefined && (field === 'steps' ? value >= 0 : value > 0);

  const logValue = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) {
      haptic('warning');
      toast(t('body.invalid'));
      return;
    }
    const v = field === 'steps' ? Math.round(value) : Math.round(value * 100) / 100;
    saveBody({ date, [field]: v });
    haptic('add');
    toast(t('body.logged', { value: fmtNum(v, 2), unit: unitLabel }));
    setRaw('');
  };

  const removeEntry = (b: BodyEntry) => {
    const prev = b[field];
    saveBody({ ...b, [field]: undefined });
    haptic('warning');
    toast(t('body.entryDeleted'), { label: t('common.undo'), run: () => saveBody({ date: b.date, [field]: prev }) });
  };

  const addPhoto = async (source: 'camera' | 'gallery') => {
    if (saving) return;
    const r = await pickPhoto(source);
    if (!r.ok) {
      if (r.reason !== 'cancelled') toast(t('body.photo.failed', { reason: r.reason }));
      return;
    }
    setSaving(true);
    try {
      const id = uid();
      await idbSet(`photo:${id}`, await downscale(r.value, 1280, 0.85));
      addPhotoMeta({ id, date, pose });
      haptic('add');
      toast(t('body.photo.added'));
    } catch (err) {
      haptic('warning');
      toast(t('body.photo.failed', { reason: (err as Error).message ?? '' }));
    } finally {
      setSaving(false);
    }
  };

  const closeViewer = () => {
    setViewer(null);
    setConfirmDelete(false);
  };

  const deletePhoto = async (id: string) => {
    await idbDel(`photo:${id}`).catch(() => {});
    deletePhotoMeta(id);
    setCompare((c) => c.filter((x) => x !== id));
    closeViewer();
    haptic('warning');
    toast(t('body.photo.deleted'));
  };

  const sortedPhotos = useMemo(() => [...photos].sort((a, b) => b.date.localeCompare(a.date)), [photos]);
  const comparing = compare
    .map((id) => photos.find((p) => p.id === id))
    .filter((p): p is ProgressPhoto => !!p)
    .sort((a, b) => a.date.localeCompare(b.date));
  const viewing = viewer ? photos.find((p) => p.id === viewer) : undefined;
  const entries = useMemo(() => [...body].filter((b) => b[field] !== undefined).reverse().slice(0, 60), [body, field]);

  const chartLabel =
    field === 'weight'
      ? last
        ? t('body.chartWeight', { value: fmtNum(last.trend), unit, change: signed(change) })
        : t('body.chartWeightEmpty')
      : t('body.chartSeries', { name: tabName, count: series.length });

  return (
    <Page title={t('body.title')} back>
      <div className="fw-screen">
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            { value: 'weight', label: t('body.tab.weight') },
            { value: 'bodyFat', label: t('body.tab.bodyFat') },
            { value: 'steps', label: t('body.tab.steps') },
            { value: 'tape', label: t('body.tab.tape') },
            { value: 'photos', label: t('body.tab.photos') },
          ]}
        />
        {tab === 'tape' ? (
          <BodyMeasurements range={range} ranges={RANGES} onRange={setRange} />
        ) : tab !== 'photos' ? (
          <>
            <form className="card fw-log-form" style={{ marginTop: 'var(--space-3)' }} onSubmit={logValue}>
              <input className="field num" type="date" value={date} max={isoDate()} onChange={(e) => setDate(e.target.value)} aria-label={t('body.date')} />
              <input
                ref={valueRef}
                className="field fw-value num"
                type="text"
                inputMode={field === 'steps' ? 'numeric' : 'decimal'}
                autoComplete="off"
                placeholder={unitLabel}
                aria-label={t('body.value', { unit: unitLabel })}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
              <button className="btn primary" type="submit" disabled={!valid}>
                {t('body.log')}
              </button>
            </form>
            {tab === 'weight' && periodTracking && (
              <div className="card tight row" style={{ gap: 'var(--space-3)' }}>
                <span className="grow">
                  {t('body.period.toggle')}
                  <span className="fw-note" style={{ display: 'block', margin: 0 }}>
                    {cycle ? t('body.period.cycleDay', { day: cycle.day, start: fmtShort(cycle.start) }) : t('body.period.hint')}
                    {cycle?.avgLength ? ` · ${t('body.period.avg', { days: cycle.avgLength })}` : ''}
                  </span>
                </span>
                <Switch
                  checked={onPeriod}
                  label={t('body.period.toggle')}
                  onChange={(v) => {
                    saveBody({ date, period: v || undefined });
                    haptic('select');
                  }}
                />
              </div>
            )}

            <div className="card">
              {tab === 'weight' && last && (
                <>
                  <div className="overline">{t('body.trend')}</div>
                  <div className="fw-hero">
                    <Ticker className="fw-hero-value" value={last.trend} format={(v) => fmtNum(v)} />
                    <span className="fw-hero-unit">{unit}</span>
                  </div>
                  <div className="fw-stats">
                    <div className="stat">
                      <Ticker className="fw-stat-value" value={change} format={(v) => signed(v)} />
                      <span>
                        {t('body.change')} ({unit})
                      </span>
                    </div>
                    <div className="stat">
                      {weeks > 0.5 ? <Ticker className="fw-stat-value" value={change / weeks} format={(v) => signed(v, 2)} /> : <span className="fw-stat-value">–</span>}
                      <span>
                        {t('body.perWeek')} ({unit})
                      </span>
                    </div>
                  </div>
                </>
              )}
              <div role="img" aria-label={chartLabel}>
                <ResponsiveContainer width="100%" height={200}>
                  {tab === 'weight' ? (
                    <LineChart data={trend} margin={{ left: -18, right: 6, top: 8 }}>
                      <CartesianGrid stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="date" tick={tick} tickFormatter={(d: string) => d.slice(5)} />
                      <YAxis domain={['dataMin - 1', 'dataMax + 1']} tick={tick} tickFormatter={(v: number) => fmtNum(v)} />
                      <Tooltip contentStyle={tooltipStyle} />
                      {periods.map((r) => (
                        <ReferenceArea key={r.from} x1={r.from < cutoff ? cutoff : r.from} x2={r.to} fill="var(--color-danger)" fillOpacity={0.08} stroke="none" ifOverflow="hidden" />
                      ))}
                      <Line dataKey="weight" name={t('body.scale')} stroke="var(--color-text-faint)" strokeWidth={0} dot={{ r: 2.5, fill: 'var(--color-text-faint)' }} isAnimationActive={false} />
                      <Line dataKey="trend" name={t('body.trendLine')} stroke="var(--color-accent)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    </LineChart>
                  ) : (
                    <LineChart data={series} margin={{ left: -10, right: 6, top: 8 }}>
                      <CartesianGrid stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="date" tick={tick} tickFormatter={(d: string) => d.slice(5)} />
                      <YAxis domain={['auto', 'auto']} tick={tick} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Line dataKey={field} name={tabName} stroke="var(--color-accent)" strokeWidth={2.5} dot={{ r: 2.5 }} isAnimationActive={false} />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
              <div role="group" aria-label={t('body.range')}>
                <Seg value={range} onChange={setRange} options={RANGES} />
              </div>
            </div>

            <h2>{t('body.entries')}</h2>
            <div className="card list tight">
              {entries.length === 0 && <p className="fw-note">{t('body.noEntries')}</p>}
              {entries.map((b) => (
                <div key={b.date} className="fw-entry">
                  <span className="grow">{fmtDate(b.date)}</span>
                  <b className="num">
                    {fmtNum(b[field], field === 'steps' ? 0 : 2)} {unitLabel}
                  </b>
                  <button className="icon-btn" aria-label={t('body.deleteEntry', { date: fmtDate(b.date) })} onClick={() => removeEntry(b)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="card" style={{ marginTop: 'var(--space-3)' }}>
              <div className="fw-photo-controls">
                <input className="field num" type="date" value={date} max={isoDate()} onChange={(e) => setDate(e.target.value)} aria-label={t('body.photo.date')} />
                <select className="field" value={pose} onChange={(e) => setPose(e.target.value as ProgressPhoto['pose'])} aria-label={t('body.photo.pose')}>
                  <option value="front">{t('body.pose.front')}</option>
                  <option value="side">{t('body.pose.side')}</option>
                  <option value="back">{t('body.pose.back')}</option>
                </select>
              </div>
              <div className="fw-actions">
                <button className="btn primary" disabled={saving} onClick={() => addPhoto('camera')}>
                  {saving ? t('body.photo.saving') : t('body.photo.camera')}
                </button>
                <button className="btn" disabled={saving} onClick={() => addPhoto('gallery')}>
                  {t('body.photo.gallery')}
                </button>
              </div>
              <p className="fw-note">{t('body.photo.private')}</p>
            </div>

            {photos.length === 0 ? (
              <EmptyState scene="photos" title={t('body.photo.emptyTitle')}>
                <p className="fw-note center" style={{ maxWidth: '32ch' }}>
                  {t('body.photo.emptySub')}
                </p>
                <button className="btn primary" style={{ marginTop: 'var(--space-3)' }} disabled={saving} onClick={() => addPhoto('camera')}>
                  {t('body.photo.camera')}
                </button>
              </EmptyState>
            ) : (
              <div className="fw-photo-grid">
                {sortedPhotos.map((p) => {
                  const sel = compare.indexOf(p.id);
                  return (
                    <div key={p.id} className="fw-photo-tile">
                      <button
                        className="fw-photo-pick"
                        aria-pressed={sel >= 0}
                        aria-label={t('body.photo.select', { date: fmtDate(p.date), pose: poseLabel(p.pose) })}
                        onClick={() => {
                          haptic('select');
                          setCompare((c) => (c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id].slice(-2)));
                        }}
                      >
                        <PhotoImg id={p.id} alt="" />
                        {sel >= 0 && (
                          <span className="fw-photo-badge num" aria-hidden>
                            {sel + 1}
                          </span>
                        )}
                      </button>
                      <button className="fw-photo-open" aria-label={t('body.photo.open', { date: fmtDate(p.date) })} onClick={() => setViewer(p.id)}>
                        <span aria-hidden>⤢</span>
                      </button>
                      <div className="fw-photo-meta num">
                        {fmtShort(p.date)} · {poseLabel(p.pose)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {comparing.length === 2 && (
              <div className="card" style={{ marginTop: 'var(--space-3)' }}>
                <div className="row between">
                  <h3 style={{ margin: 0 }}>{t('body.photo.compare')}</h3>
                  <span className="fw-note num" style={{ margin: 0 }}>
                    {t('body.photo.apart', { days: Math.round((new Date(`${comparing[1].date}T00:00:00`).getTime() - new Date(`${comparing[0].date}T00:00:00`).getTime()) / DAY_MS) })}
                  </span>
                </div>
                <div className="fw-compare" style={{ marginTop: 'var(--space-3)' }}>
                  {comparing.map((p) => (
                    <div key={p.id}>
                      <PhotoImg id={p.id} alt={t('body.photo.alt', { pose: poseLabel(p.pose), date: fmtDate(p.date) })} />
                      <div className="fw-photo-meta num">
                        {fmtDate(p.date)} · {poseLabel(p.pose)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="fw-actions">
                  <button className="btn ghost" onClick={() => setCompare([])}>
                    {t('body.photo.clear')}
                  </button>
                </div>
              </div>
            )}

            <Sheet open={!!viewing} onClose={closeViewer} title={t('body.photo.viewer')}>
              {viewing && (
                <div className="fw-screen fw-viewer">
                  <PhotoImg id={viewing.id} alt={t('body.photo.alt', { pose: poseLabel(viewing.pose), date: fmtDate(viewing.date) })} />
                  <div className="fw-photo-meta num">
                    {fmtDate(viewing.date)} · {poseLabel(viewing.pose)}
                  </div>
                  <button
                    className={`btn block ${confirmDelete ? 'fw-danger-solid' : 'danger'}`}
                    onClick={() => {
                      if (confirmDelete) deletePhoto(viewing.id);
                      else {
                        haptic('warning');
                        setConfirmDelete(true);
                      }
                    }}
                  >
                    {confirmDelete ? t('body.photo.deleteConfirm') : t('body.photo.delete')}
                  </button>
                </div>
              )}
            </Sheet>
          </>
        )}
      </div>
    </Page>
  );
}
