import { useEffect, useState } from 'react';
import { clear as idbClear, del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import { useNavigate } from 'react-router-dom';
import { Page, SettingRow, Sheet, Switch } from '../components/ui';
import { MEASUREMENT_KEYS, NUTRIENT_KEYS, type ProgressPhoto } from '../domain/types';
import { fromGeneric, importMacroFactor, isMacroFactorWorkbook, type ExternalImport } from '../domain/importMacroFactor';
import { importSheets, parseCsv, type Cell, type SheetRows } from '../domain/importMf';
import { isoDate } from '../domain/util';
import { t } from '../i18n';
import { blobToBase64 } from '../platform/camera';
import { pickFile, saveExport } from '../platform/files';
import { haptic } from '../platform/haptics';
import { getAiKey, removeAiKey } from '../platform/secrets';
import { DEFAULT_SETTINGS, useAnalysis, useFoods, useStore, type DataCategory, type State } from '../store';
import { toast } from '../ui/snackbar';
import '../styles/settings.css';

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

/** Store keys that a backup carries (AD-9: never the AI key, which lives outside the store). */
const BACKUP_KEYS = ['settings', 'profile', 'foods', 'recipes', 'favorites', 'log', 'meta', 'body', 'photos', 'goals', 'activeGoalId', 'snapshots', 'servingMemory', 'externalExpenditure'] as const;
const DATA_CATEGORIES: DataCategory[] = ['nutrition', 'weight', 'bodyFat', 'steps', 'measurements', 'period', 'photos'];

type Backup = Partial<State> & { app: 'satiago' | 'fuelwise'; exportedAt?: string };
interface PhotoFileItem extends ProgressPhoto {
  mime?: string;
  data: string;
}
interface PhotoFile {
  app: 'satiago' | 'fuelwise';
  kind: 'photos';
  photos: PhotoFileItem[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Backups made before the app was renamed from Fuelwise still restore. */
const isOurs = (app: unknown) => app === 'satiago' || app === 'fuelwise';
const isBackup = (v: unknown): v is Backup => isRecord(v) && isOurs(v.app) && v.kind === undefined && Array.isArray(v.log);
const isPhotoFile = (v: unknown): v is PhotoFile =>
  isRecord(v) &&
  isOurs(v.app) &&
  v.kind === 'photos' &&
  Array.isArray(v.photos) &&
  v.photos.every((p) => isRecord(p) && typeof p.id === 'string' && typeof p.date === 'string' && typeof p.data === 'string' && ['front', 'side', 'back'].includes(p.pose as string));

const base64ToBlob = (data: string, type: string) => {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

const fmtSize = (bytes: number) =>
  bytes < 1024 * 1024 ? t('data.sizeKb', { n: Math.max(1, Math.round(bytes / 1024)) }) : t('data.sizeMb', { n: Math.round((bytes / (1024 * 1024)) * 10) / 10 });

export default function DataPage() {
  const st = useStore();
  const a = useAnalysis();
  const nav = useNavigate();
  const stamp = isoDate();
  const [busy, setBusy] = useState<string | null>(null);
  const [photoBytes, setPhotoBytes] = useState<number>();
  const [pending, setPending] = useState<Backup | null>(null);
  const [wipeStep, setWipeStep] = useState<0 | 1 | 2>(0);
  const [typed, setTyped] = useState('');
  const [external, setExternal] = useState<(ExternalImport & { file: string; macroFactor: boolean }) | null>(null);
  const [withProfile, setWithProfile] = useState(true);
  const [withGoals, setWithGoals] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [armed, setArmed] = useState<DataCategory | null>(null);
  const foods = useFoods();

  // Size estimate for the photos export: base64 adds about a third.
  useEffect(() => {
    let live = true;
    Promise.all(st.photos.map((p) => idbGet<Blob>(`photo:${p.id}`).catch(() => undefined))).then((blobs) => {
      if (live) setPhotoBytes(blobs.reduce((s, b) => s + (b ? Math.ceil(b.size / 3) * 4 + 120 : 0), 0));
    });
    return () => {
      live = false;
    };
  }, [st.photos]);

  const save = async (name: string, data: string, mime: string) => {
    const r = await saveExport(name, data, mime);
    if (!r.ok) {
      haptic('warning');
      toast(t('data.exportFailed', { reason: r.reason }));
    }
  };

  const exportLog = () => {
    const rows: unknown[][] = [['date', 'time', 'food', 'quantity', 'serving', 'grams', ...NUTRIENT_KEYS]];
    [...st.log]
      .sort((x, y) => x.date.localeCompare(y.date) || x.minute - y.minute)
      .forEach((e) => rows.push([e.date, `${Math.floor(e.minute / 60)}:${String(e.minute % 60).padStart(2, '0')}`, e.name, e.qty, e.servingLabel, e.grams, ...NUTRIENT_KEYS.map((k) => e.n[k])]));
    return save(`satiago-food-log-${stamp}.csv`, csv(rows), 'text/csv');
  };

  const exportMetrics = () => {
    const trend = new Map(a.trend.map((p) => [p.date, p.trend]));
    const exp = new Map(a.expenditure.map((p) => [p.date, p.expenditure]));
    const dates = [...new Set([...st.body.map((b) => b.date), ...a.expenditure.map((p) => p.date)])].sort();
    const unit = st.settings.weightUnit;
    const rows: unknown[][] = [
      ['date', `scale_weight_${unit}`, `trend_weight_${unit}`, 'expenditure_kcal', 'body_fat_pct', 'steps', 'water_ml', 'partial', 'fasted', 'period', ...MEASUREMENT_KEYS.map((k) => `${k}_cm`)],
    ];
    for (const d of dates) {
      const b = st.body.find((x) => x.date === d);
      const m = st.meta.find((x) => x.date === d);
      rows.push([d, b?.weight, trend.get(d), exp.get(d), b?.bodyFat, b?.steps, m?.waterMl, m?.partial ? 1 : '', m?.fasted ? 1 : '', b?.period ? 1 : '', ...MEASUREMENT_KEYS.map((k) => b?.measurements?.[k])]);
    }
    return save(`satiago-metrics-${stamp}.csv`, csv(rows), 'text/csv');
  };

  /** Custom foods, saved online foods and recipes, per 100 g, so they can be reused elsewhere. */
  const exportLibrary = () => {
    const rows: unknown[][] = [['type', 'name', 'brand', 'barcode', 'serving', 'serving_grams', ...NUTRIENT_KEYS.map((k) => `${k}_per_100g`)]];
    for (const f of foods.filter((x) => x.source !== 'builtin').sort((x, y) => x.name.localeCompare(y.name))) {
      const s = f.servings[0];
      rows.push([f.source === 'recipe' ? 'recipe' : f.source === 'openfoodfacts' ? 'online' : 'custom', f.name, f.brand, f.barcode, s?.label, s?.grams, ...NUTRIENT_KEYS.map((k) => f.per100[k])]);
    }
    return save(`satiago-library-${stamp}.csv`, csv(rows), 'text/csv');
  };

  const counts: Record<DataCategory, number> = {
    nutrition: new Set(st.log.map((e) => e.date)).size,
    weight: st.body.filter((b) => b.weight !== undefined).length,
    bodyFat: st.body.filter((b) => b.bodyFat !== undefined).length,
    steps: st.body.filter((b) => b.steps !== undefined).length,
    measurements: st.body.filter((b) => b.measurements && Object.values(b.measurements).some((v) => v)).length,
    period: st.body.filter((b) => b.period).length,
    photos: st.photos.length,
  };
  const deleteCategory = async (c: DataCategory) => {
    if (armed !== c) {
      haptic('warning');
      setArmed(c);
      return;
    }
    if (c === 'photos') await Promise.all(st.photos.map((p) => idbDel(`photo:${p.id}`).catch(() => {})));
    st.deleteData(c);
    setArmed(null);
    haptic('success');
    toast(t('data.deletedCategory', { name: t(`data.cat.${c}`) }));
  };

  const exportBackup = () => {
    const out: Record<string, unknown> = { app: 'satiago', version: 1, exportedAt: new Date().toISOString() };
    for (const k of BACKUP_KEYS) out[k] = st[k];
    return save(`satiago-backup-${stamp}.json`, JSON.stringify(out), 'application/json');
  };

  const exportPhotos = async () => {
    const photos: PhotoFileItem[] = [];
    for (const p of st.photos) {
      const b = await idbGet<Blob>(`photo:${p.id}`).catch(() => undefined);
      if (b) photos.push({ id: p.id, date: p.date, pose: p.pose, mime: b.type || 'image/jpeg', data: await blobToBase64(b) });
    }
    const file: PhotoFile & { version: number; exportedAt: string } = { app: 'satiago', kind: 'photos', version: 1, exportedAt: new Date().toISOString(), photos };
    return save(`satiago-photos-${stamp}.json`, JSON.stringify(file), 'application/json');
  };

  const run = async (id: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(id);
    try {
      await fn();
    } catch (e) {
      haptic('warning');
      toast(t('data.exportFailed', { reason: (e as Error).message ?? '' }));
    } finally {
      setBusy(null);
    }
  };

  const importPhotos = async (file: PhotoFile) => {
    const known = new Set(useStore.getState().photos.map((p) => p.id));
    let added = 0;
    for (const p of file.photos) {
      const hasBlob = !!(await idbGet(`photo:${p.id}`).catch(() => undefined));
      if (!hasBlob) await idbSet(`photo:${p.id}`, base64ToBlob(p.data, p.mime || 'image/jpeg'));
      if (!known.has(p.id)) useStore.getState().addPhoto({ id: p.id, date: p.date, pose: p.pose });
      if (!hasBlob || !known.has(p.id)) added++;
    }
    haptic(added ? 'success' : 'select');
    toast(added ? t('data.photosImported', { count: added }) : t('data.photosNothing'));
  };

  const importFile = async () => {
    const f = await pickFile('application/json,.json');
    if (!f) return;
    await run('import', async () => {
      let data: unknown;
      try {
        data = JSON.parse(await f.text());
      } catch {
        data = undefined;
      }
      if (isPhotoFile(data)) return importPhotos(data);
      if (isBackup(data)) {
        setPending(data);
        return;
      }
      haptic('warning');
      toast(t('data.notSatiago'));
    });
  };

  /** MacroFactor (or similar) spreadsheet exports: .xlsx or .csv. */
  const importOtherApp = async () => {
    const f = await pickFile('.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (!f) return;
    await run('external', async () => {
      let sheets: SheetRows[];
      if (/\.csv$/i.test(f.name) || f.type === 'text/csv') {
        sheets = [{ name: f.name, rows: parseCsv(await f.text()) }];
      } else {
        const { default: readXlsxFile } = await import('read-excel-file/browser');
        // The library types Date cells as `typeof Date`; at runtime they are Date instances.
        sheets = (await readXlsxFile(f)).map((sh) => ({ name: sh.sheet, rows: sh.data as unknown as Cell[][] }));
      }
      const macroFactor = isMacroFactorWorkbook(sheets);
      // Days that already have itemized foods (logged here or imported from a food log) keep them instead of a daily total.
      const own = new Set(st.log.filter((e) => !e.id.includes('-total-')).map((e) => e.date));
      const r = macroFactor ? importMacroFactor(sheets, st.settings.weightUnit, { skipTotalsOn: own }) : fromGeneric(importSheets(sheets, st.settings.weightUnit, /macrofactor/i.test(f.name) ? 'MacroFactor' : 'Imported'));
      if (!r.log.length && !r.body.length && !r.foods.length) {
        haptic('warning');
        toast(r.warnings[0] ?? t('data.extNothing'));
        return;
      }
      setWithProfile(true);
      setWithGoals(true);
      setExternal({ ...r, file: f.name, macroFactor });
    });
  };

  const applyExternal = () => {
    if (!external) return;
    st.importExternal(external, { profile: withProfile && !!external.profile, goals: withGoals && external.goals.length > 0 });
    setExternal(null);
    haptic('success');
    toast(t('data.extDone', { days: external.summary.days }));
  };

  const restore = async () => {
    if (!pending) return;
    const clean: Partial<State> = {};
    for (const k of BACKUP_KEYS) if (k in pending) (clean as Record<string, unknown>)[k] = pending[k];
    // The key never travels with a backup, so AI Assist stays off until a key is added here.
    if (clean.settings) {
      // Keys never travel in backups: keep AI Assist on only if this device has a key for the backup's provider.
      const ai = { ...DEFAULT_SETTINGS.ai, ...clean.settings.ai };
      if (!(await getAiKey(ai.provider))) clean.settings = { ...clean.settings, ai: { ...ai, enabled: false } };
    }
    st.importAll(clean);
    setPending(null);
    haptic('success');
    toast(t('data.restored'));
  };

  const closeWipe = () => {
    setWipeStep(0);
    setTyped('');
  };

  const wipe = async () => {
    if (typed.trim() !== t('data.deleteWord')) return;
    await idbClear();
    await removeAiKey().catch(() => {});
    st.resetAll();
    closeWipe();
    nav('/welcome', { replace: true });
  };

  const pendingDate = pending?.exportedAt && !Number.isNaN(Date.parse(pending.exportedAt)) ? new Date(pending.exportedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : t('data.restoreUnknownDate');

  return (
    <Page title={t('data.title')} back>
      <div className="fw-screen">
        <h2>{t('data.export')}</h2>
        <div className="card">
          <div className="fw-export">
            <button className="btn block" disabled={busy !== null} onClick={() => run('log', exportLog)}>
              {busy === 'log' ? t('data.exporting') : t('data.exportLog')}
            </button>
          </div>
          <div className="fw-export">
            <button className="btn block" disabled={busy !== null} onClick={() => run('metrics', exportMetrics)}>
              {busy === 'metrics' ? t('data.exporting') : t('data.exportMetrics')}
            </button>
          </div>
          <div className="fw-export">
            <button className="btn block" disabled={busy !== null || !foods.some((f) => f.source !== 'builtin')} onClick={() => run('library', exportLibrary)}>
              {busy === 'library' ? t('data.exporting') : t('data.exportLibrary')}
            </button>
          </div>
          <div className="fw-export">
            <button className="btn primary block" disabled={busy !== null} onClick={() => run('backup', exportBackup)}>
              {busy === 'backup' ? t('data.exporting') : t('data.exportBackup')}
            </button>
            <p className="fw-note">{t('data.backupNote')}</p>
          </div>
          <div className="fw-export">
            <button className="btn block" disabled={busy !== null || st.photos.length === 0} onClick={() => run('photos', exportPhotos)}>
              {busy === 'photos' ? t('data.exporting') : t('data.exportPhotos')}
            </button>
            <p className="fw-note num">
              {st.photos.length === 0 ? t('data.photosNone') : t('data.photosNote', { count: st.photos.length, size: photoBytes === undefined ? '…' : fmtSize(photoBytes) })}
            </p>
          </div>
        </div>

        <h2>{t('data.import')}</h2>
        <div className="card">
          <button className="btn block" disabled={busy !== null} onClick={importFile}>
            {t('data.importFile')}
          </button>
          <p className="fw-note">{t('data.importDesc')}</p>
          <button className="btn block" style={{ marginTop: 'var(--space-3)' }} disabled={busy !== null} onClick={importOtherApp}>
            {busy === 'external' ? t('data.extReading') : t('data.extButton')}
          </button>
          <p className="fw-note">{t('data.extDesc')}</p>
        </div>

        <h2>{t('data.danger')}</h2>
        <div className="card">
          <button className="btn danger block" onClick={() => (setArmed(null), setDeleteOpen(true))}>
            {t('data.deleteSome')}
          </button>
          <button className="btn danger block" style={{ marginTop: 'var(--space-3)' }} onClick={() => setWipeStep(1)}>
            {t('data.deleteAll')}
          </button>
        </div>
      </div>

      <Sheet open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('data.deleteSome')}>
        <p className="fw-note" style={{ marginTop: 0 }}>
          {t('data.deleteSomeDesc')}
        </p>
        <div className="list">
          {DATA_CATEGORIES.map((c) => (
            <div key={c} className="row" style={{ padding: '8px 0', gap: 8 }}>
              <span className="grow" style={{ minWidth: 0 }}>
                {t(`data.cat.${c}`)}
                <span className="fw-note num" style={{ display: 'block', margin: 0 }}>
                  {t(c === 'photos' ? 'data.countPhotos' : 'data.countDays', { count: counts[c] })}
                </span>
              </span>
              <button className={`btn sm ${armed === c ? 'fw-danger-solid' : 'danger'}`} disabled={!counts[c]} onClick={() => void deleteCategory(c)}>
                {armed === c ? t('data.deleteConfirmShort') : t('common.delete')}
              </button>
            </div>
          ))}
        </div>
      </Sheet>

      <Sheet open={!!external} onClose={() => setExternal(null)} title={t('data.extTitle')}>
        {external && (
          <div className="fw-screen fw-sheet-body">
            <p className="fw-body-text">{external.macroFactor ? t('data.extMacroFactor', { file: external.file }) : t('data.extFile', { file: external.file })}</p>
            <ul className="fw-import-list num">
              {(
                [
                  ['dailyTotals', 'data.ext.dailyTotals'],
                  ['expenditure', 'data.ext.expenditure'],
                  ['foodEntries', 'data.ext.foodEntries'],
                  ['weights', 'data.ext.weights'],
                  ['bodyFat', 'data.ext.bodyFat'],
                  ['steps', 'data.ext.steps'],
                  ['measurements', 'data.ext.measurements'],
                  ['flags', 'data.ext.flags'],
                  ['notes', 'data.ext.notes'],
                  ['foods', 'data.ext.foods'],
                  ['recipes', 'data.ext.recipes'],
                ] as const
              )
                .filter(([k]) => external.summary[k] > 0)
                .map(([k, key]) => (
                  <li key={k}>{t(key, { count: external.summary[k] })}</li>
                ))}
            </ul>
            {external.summary.dailyTotals > 0 && external.macroFactor && <p className="fw-note">{t('data.extTotalsNote')}</p>}
            {(external.profile || external.goals.length > 0) && (
              <div className="card list tight">
                {external.profile && (
                  <SettingRow title={t('data.extProfile')} desc={t('data.extProfileDesc')}>
                    <Switch checked={withProfile} onChange={setWithProfile} label={t('data.extProfile')} />
                  </SettingRow>
                )}
                {external.goals.length > 0 && (
                  <SettingRow title={t('data.extGoals')} desc={t('data.extGoalsDesc', { goals: external.summary.goals, targets: external.summary.targets })}>
                    <Switch checked={withGoals} onChange={setWithGoals} label={t('data.extGoals')} />
                  </SettingRow>
                )}
              </div>
            )}
            {external.summary.skipped > 0 && <p className="fw-note">{t('data.extSkipped', { count: external.summary.skipped })}</p>}
            {external.summary.ignored.length > 0 && <p className="fw-note">{t('data.extIgnored', { sheets: external.summary.ignored.join(', ') })}</p>}
            <p className="fw-note">{t('data.extMerge')}</p>
            <button className="btn primary block" onClick={applyExternal}>
              {t('data.extConfirm')}
            </button>
            <button className="btn ghost block" onClick={() => setExternal(null)}>
              {t('common.cancel')}
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={!!pending} onClose={() => setPending(null)} title={t('data.restoreTitle')}>
        {pending && (
          <div className="fw-screen fw-sheet-body">
            <p className="fw-body-text num">
              {t('data.restoreBody', { date: pendingDate, entries: pending.log?.length ?? 0, body: pending.body?.length ?? 0 })}
            </p>
            <button className="btn block fw-danger-solid" onClick={restore}>
              {t('data.restoreConfirm')}
            </button>
            <button className="btn ghost block" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={wipeStep > 0} onClose={closeWipe} title={t('data.deleteTitle')}>
        <div className="fw-screen fw-sheet-body">
          <p className="fw-body-text">{t('data.deleteBody')}</p>
          {wipeStep === 1 ? (
            <button
              className="btn danger block"
              onClick={() => {
                haptic('warning');
                setWipeStep(2);
              }}
            >
              {t('data.deleteContinue')}
            </button>
          ) : (
            <form
              className="fw-sheet-body"
              onSubmit={(e) => {
                e.preventDefault();
                wipe();
              }}
            >
              <label className="fw-field-label" htmlFor="wipe-confirm">
                {t('data.deleteType', { word: t('data.deleteWord') })}
              </label>
              <input id="wipe-confirm" className="field" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
              <button className="btn block fw-danger-solid" type="submit" disabled={typed.trim() !== t('data.deleteWord')}>
                {t('data.deleteFinal')}
              </button>
            </form>
          )}
          <button className="btn ghost block" onClick={closeWipe}>
            {t('common.cancel')}
          </button>
        </div>
      </Sheet>
    </Page>
  );
}
