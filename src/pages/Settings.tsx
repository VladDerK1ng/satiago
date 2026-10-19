import { useEffect, useState, type FormEvent } from 'react';
import { NumField, Page, Seg, SettingRow, Switch } from '../components/ui';
import { minuteLabel } from '../components/FoodSheet';
import { weekdayName } from '../domain/coach';
import { LB_PER_KG } from '../domain/expenditure';
import { planHealthExport, planHealthImport, sampleTime, syncStartDate, type HealthField, type HealthSamples } from '../domain/healthSync';
import { AI_PROVIDERS, ANTHROPIC_MODELS, aiHostFor, checkBaseUrl, defaultModelFor, isAiProviderId, providerPreset, resolveBaseUrl, supportsUrlImport, type AiProviderId } from '../domain/aiProviders';
import { SHORTCUT_IDS, type ActivityLevel, type Settings, type ShortcutId, type WeightUnit } from '../domain/types';
import { isoDate } from '../domain/util';
import { t } from '../i18n';
import { listModels, testKey } from '../platform/ai';
import { haptic } from '../platform/haptics';
import { preciseRemindersAllowed, requestPreciseReminders, sendTestNotification } from '../platform/notifications';
import { connectHealth, healthAvailable, openHealthSettings, readDaily, writeSample } from '../platform/health';
import { isNative } from '../platform/native';
import { getAiKey, removeAiKey, secretsAreHardwareBacked, setAiKey } from '../platform/secrets';
import { useActiveGoal, useStore } from '../store';
import { toast } from '../ui/snackbar';
import '../styles/settings.css';

const ACCENTS = ['#16a34a', '#0ea5e9', '#7c5cff', '#e8590c', '#e64980', '#eab308'];
const READ_FIELDS: HealthField[] = ['weight', 'bodyFat', 'steps'];

/** "HH:MM" from a time input to minutes after midnight; undefined when cleared. */
const parseTime = (v: string): number | undefined => {
  const m = /^(\d{1,2}):(\d{2})/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};

const fmtSyncTime = (v: string) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/**
 * One Health Connect sync (FR-32): read weight, body fat and steps since the last sync (or 90 days),
 * merge them without overwriting app values, then write the app's weigh-ins, body fat and, when
 * enabled, finished days' calories and water. Merge rules live in domain/healthSync.
 */
async function runHealthSync(): Promise<{ ok: boolean; message: string }> {
  const now = new Date();
  const start = useStore.getState();
  const from = syncStartDate(start.settings.health.lastSync, now);
  const fromDate = new Date(`${from}T00:00:00`);

  const reads = await Promise.all(READ_FIELDS.map((f) => readDaily(f, fromDate)));
  const samples: HealthSamples = {};
  const failed: HealthField[] = [];
  let firstReason = '';
  READ_FIELDS.forEach((f, i) => {
    const r = reads[i];
    if (r.ok) samples[f] = r.value;
    else {
      failed.push(f);
      firstReason ||= r.reason;
    }
  });
  if (failed.length === READ_FIELDS.length) return { ok: false, message: t('settings.health.readFailed', { reason: firstReason }) };

  const plan = planHealthImport(start.body, samples, start.settings.weightUnit);
  for (const p of plan.patches) start.saveBody(p);

  const s = useStore.getState();
  const writes = planHealthExport({
    body: s.body,
    log: s.log,
    meta: s.meta,
    unit: s.settings.weightUnit,
    from,
    today: isoDate(now),
    writeNutrition: s.settings.health.writeNutrition,
    existing: samples,
  });
  let written = 0;
  for (const w of writes) {
    const r = await writeSample(w.type, w.value, sampleTime(w.date, now));
    if (r.ok) written++;
  }
  // When every write failed (for example, write permission denied), keep the old sync point so
  // finished days are offered again next time instead of being skipped.
  if (writes.length === 0 || written > 0) {
    const cur = useStore.getState();
    cur.setSettings({ health: { ...cur.settings.health, lastSync: now.toISOString() } });
  }

  const parts = [plan.imported + written === 0 ? t('settings.health.upToDate') : t('settings.health.result', { imported: plan.imported, written })];
  if (plan.unusual.length) parts.push(t('settings.health.unusual', { count: plan.unusual.length, weight: plan.unusual[0].weight, date: plan.unusual[0].date }));
  if (failed.length) parts.push(t('settings.health.partialRead', { types: failed.map((f) => t(`settings.health.type.${f}`)).join(', ') }));
  if (written < writes.length) parts.push(t('settings.health.writeFailed', { count: writes.length - written }));
  return { ok: failed.length === 0 && written === writes.length, message: parts.join(' ') };
}

function RemindersSection() {
  const reminders = useStore((s) => s.settings.reminders);
  const setSettings = useStore((s) => s.setSettings);
  const goal = useActiveGoal();
  const coached = goal && goal.style !== 'manual';
  const set = (patch: Partial<typeof reminders>) => setSettings({ reminders: { ...reminders, ...patch } });

  return (
    <>
      <h2>{t('settings.reminders')}</h2>
      <div className="card list tight">
        <SettingRow title={t('settings.reminders.checkIn')} desc={coached ? t('settings.reminders.checkInDesc', { day: weekdayName(goal.checkInDay) }) : t('settings.reminders.checkInNoGoal')}>
          <Switch checked={reminders.checkIn} onChange={(checkIn) => set({ checkIn })} label={t('settings.reminders.checkIn')} />
        </SettingRow>
        {reminders.checkIn && (
          <SettingRow title={t('settings.reminders.checkInTime')}>
            <input
              className="field fw-time num"
              type="time"
              aria-label={t('settings.reminders.checkInTime')}
              value={minuteLabel(reminders.checkInMinute)}
              onChange={(e) => {
                const m = parseTime(e.target.value);
                if (m !== undefined) set({ checkInMinute: m });
              }}
            />
          </SettingRow>
        )}
        <SettingRow title={t('settings.reminders.weighIn')} desc={t('settings.reminders.weighInDesc')}>
          <Switch checked={reminders.weighIn} onChange={(weighIn) => set({ weighIn })} label={t('settings.reminders.weighIn')} />
        </SettingRow>
        {reminders.weighIn && (
          <SettingRow title={t('settings.reminders.weighInTime')}>
            <input
              className="field fw-time num"
              type="time"
              aria-label={t('settings.reminders.weighInTime')}
              value={minuteLabel(reminders.weighInMinute)}
              onChange={(e) => {
                const m = parseTime(e.target.value);
                if (m !== undefined) set({ weighInMinute: m });
              }}
            />
          </SettingRow>
        )}
        {isNative() && (reminders.checkIn || reminders.weighIn) && (
          <SettingRow title={t('settings.reminders.precise')} desc={t('settings.reminders.preciseDesc')}>
            <Switch
              checked={reminders.precise}
              label={t('settings.reminders.precise')}
              onChange={async (precise) => {
                if (precise && !(await preciseRemindersAllowed()) && !(await requestPreciseReminders())) {
                  toast(t('settings.reminders.preciseDenied'));
                  return;
                }
                set({ precise });
              }}
            />
          </SettingRow>
        )}
        {isNative() && (
          <div style={{ padding: 'var(--space-3) 0' }}>
            <button
              className="btn block"
              onClick={async () => {
                const r = await sendTestNotification();
                toast(r.ok ? t('settings.reminders.testSent') : r.reason);
              }}
            >
              {t('settings.reminders.test')}
            </button>
          </div>
        )}
        {!isNative() && <p className="fw-note">{t('settings.reminders.web')}</p>}
      </div>
    </>
  );
}

function HealthSection() {
  const health = useStore((s) => s.settings.health);
  const setSettings = useStore((s) => s.setSettings);
  const [available, setAvailable] = useState<boolean>();
  const [busy, setBusy] = useState<'connect' | 'sync' | null>(null);

  useEffect(() => {
    let live = true;
    healthAvailable().then((v) => live && setAvailable(v));
    return () => {
      live = false;
    };
  }, []);

  const sync = async () => {
    setBusy('sync');
    try {
      const r = await runHealthSync();
      haptic(r.ok ? 'success' : 'warning');
      toast(r.message);
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy('connect');
    const r = await connectHealth(useStore.getState().settings.health.writeNutrition);
    setBusy(null);
    if (!r.ok) {
      haptic('warning');
      toast(r.reason);
      return;
    }
    setSettings({ health: { ...useStore.getState().settings.health, enabled: true } });
    toast(t('settings.health.connectedToast'));
    await sync();
  };

  const connected = health.enabled && available === true;

  return (
    <>
      <h2>{t('settings.health')}</h2>
      <div className="card">
        <div className="row between">
          <h3 style={{ margin: 0 }}>{t('settings.health')}</h3>
          {available && <span className={`fw-status${connected ? ' on' : ''}`}>{connected ? t('settings.health.connected') : t('settings.health.notConnected')}</span>}
        </div>
        <p className="fw-note">{t('settings.health.intro')}</p>
        {available === undefined && <p className="fw-note" aria-live="polite">{t('settings.health.checking')}</p>}
        {available === false && <p className="fw-caution">{t('settings.health.unavailable')}</p>}
        {available && !health.enabled && (
          <div className="fw-actions">
            <button className="btn primary" disabled={busy !== null} onClick={connect}>
              {busy === 'connect' ? t('settings.health.connecting') : t('settings.health.connect')}
            </button>
          </div>
        )}
        {connected && (
          <>
            <div className="list" style={{ marginTop: 'var(--space-2)' }}>
              <SettingRow title={t('settings.health.writeNutrition')} desc={t('settings.health.writeNutritionDesc')}>
                <Switch checked={health.writeNutrition} onChange={async (writeNutrition) => {
                    // Turning writes on asks Health Connect for the nutrition and hydration scopes first.
                    if (writeNutrition) {
                      const r = await connectHealth(true);
                      if (!r.ok) return toast(r.reason);
                    }
                    setSettings({ health: { ...health, writeNutrition } });
                  }} label={t('settings.health.writeNutrition')} />
              </SettingRow>
            </div>
            <p className="fw-note num" aria-live="polite">
              {health.lastSync ? t('settings.health.lastSync', { time: fmtSyncTime(health.lastSync) }) : t('settings.health.never')}
            </p>
            <div className="fw-actions">
              <button className="btn primary" disabled={busy !== null} onClick={sync} aria-busy={busy === 'sync'}>
                {busy === 'sync' ? t('settings.health.syncing') : t('settings.health.syncNow')}
              </button>
              <button className="btn" onClick={() => openHealthSettings()}>
                {t('settings.health.permissions')}
              </button>
            </div>
            <ul className="fw-facts">
              <li>{t('settings.health.rules')}</li>
              <li>{t('settings.health.stepsNote')}</li>
            </ul>
            <div className="fw-actions">
              <button
                className="btn ghost"
                disabled={busy !== null}
                onClick={() => {
                  setSettings({ health: { ...health, enabled: false } });
                  toast(t('settings.health.disconnected'));
                }}
              >
                {t('settings.health.disconnect')}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

type AiSettings = Settings['ai'];

const providerLabel = (id: AiProviderId) => (id === 'custom' ? t('settings.ai.providerCustom') : providerPreset(id).label);

function AiSection() {
  const ai = useStore((s) => s.settings.ai);
  const setSettings = useStore((s) => s.setSettings);
  const [keyState, setKeyState] = useState<{ provider: AiProviderId; has: boolean }>();
  const [replacing, setReplacing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | 'models' | null>(null);
  const [loaded, setLoaded] = useState<{ provider: AiProviderId; base?: string; ids: string[] }>();
  const [urlDraft, setUrlDraft] = useState(ai.baseUrl ?? '');
  const [urlError, setUrlError] = useState<string>();
  const hardware = secretsAreHardwareBacked();

  const provider = ai.provider;
  const custom = provider === 'custom';
  const anthropic = provider === 'anthropic';
  const name = providerLabel(provider);
  const base = resolveBaseUrl(ai);
  const host = aiHostFor(ai);
  const model = ai.model.trim();
  // The key check is per provider; a result for another provider means "still checking".
  const hasKey = keyState?.provider === provider ? keyState.has : undefined;

  useEffect(() => {
    let live = true;
    getAiKey(provider).then((k) => live && setKeyState({ provider, has: !!k }));
    return () => {
      live = false;
    };
  }, [provider]);

  // AI Assist can only be on while the selected provider has a key.
  useEffect(() => {
    if (hasKey === false && ai.enabled) setSettings({ ai: { ...ai, enabled: false } });
  }, [hasKey, ai, setSettings]);

  const setAi = (patch: Partial<AiSettings>) => setSettings({ ai: { ...useStore.getState().settings.ai, ...patch } });

  const changeProvider = (next: string) => {
    if (!isAiProviderId(next) || next === provider) return;
    setAi({ provider: next, model: defaultModelFor(next) });
    setReplacing(false);
    setDraft('');
    setUrlError(undefined);
    setUrlDraft(useStore.getState().settings.ai.baseUrl ?? '');
  };

  const saveBaseUrl = (e: FormEvent) => {
    e.preventDefault();
    const r = checkBaseUrl(urlDraft);
    if (!r.ok) {
      haptic('warning');
      setUrlError(t(`settings.ai.baseUrl.${r.problem}`));
      return;
    }
    setUrlError(undefined);
    setUrlDraft(r.value);
    setAi({ baseUrl: r.value });
    toast(t('settings.ai.baseUrlSaved', { host: new URL(r.value).host }));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const key = draft.trim();
    if (!key || busy) return;
    const target = provider;
    setBusy('save');
    try {
      await setAiKey(key, target);
      setKeyState({ provider: target, has: true });
      setReplacing(false);
      setDraft('');
      toast(t('settings.ai.saved'));
    } catch (err) {
      haptic('warning');
      toast(t('settings.ai.saveFailed', { reason: (err as Error).message ?? '' }));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const r = await testKey(useStore.getState().settings.ai);
      const label = ANTHROPIC_MODELS.find((m) => m.id === model)?.label ?? model;
      haptic(r.ok ? 'success' : 'warning');
      toast(r.ok ? t('settings.ai.testOk', { model: label }) : t('settings.ai.testFail', { reason: r.reason }));
    } finally {
      setBusy(null);
    }
  };

  const loadModels = async () => {
    const cfg = useStore.getState().settings.ai;
    setBusy('models');
    try {
      const r = await listModels(cfg);
      if (!r.ok) {
        haptic('warning');
        toast(t('settings.ai.modelsFailed', { reason: r.reason }));
        return;
      }
      setLoaded({ provider: cfg.provider, base: resolveBaseUrl(cfg), ids: r.value });
      toast(t('settings.ai.modelsLoaded', { count: r.value.length }));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    const target = provider;
    setBusy('remove');
    try {
      await removeAiKey(target);
      setKeyState({ provider: target, has: false });
      setReplacing(false);
      setAi({ enabled: false });
      toast(t('settings.ai.removed'));
    } finally {
      setBusy(null);
    }
  };

  const choices = anthropic ? ANTHROPIC_MODELS : loaded && loaded.provider === provider && loaded.base === base ? loaded.ids.map((id) => ({ id, label: id })) : [];
  const inList = choices.some((c) => c.id === model);
  const showForm = hasKey === false || replacing;
  const canEnable = !!hasKey && !!base && !!model;
  const enableDesc = !hasKey
    ? t('settings.ai.enableNeedsKey')
    : !base
      ? t('settings.ai.enableNeedsUrl')
      : !model
        ? t('settings.ai.enableNeedsModel')
        : t('settings.ai.enableDesc');

  return (
    <>
      <h2>{t('settings.ai')}</h2>
      <div className="card">
        <p className="fw-body-text">{t('settings.ai.intro')}</p>
        <div className="list">
          <SettingRow title={t('settings.ai.provider')} desc={t('settings.ai.providerDesc')}>
            <select className="field fw-select" aria-label={t('settings.ai.provider')} value={provider} disabled={busy !== null} onChange={(e) => changeProvider(e.target.value)}>
              {AI_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {providerLabel(p.id)}
                </option>
              ))}
            </select>
          </SettingRow>
        </div>

        {custom && (
          <form onSubmit={saveBaseUrl} noValidate>
            <label className="fw-field-label" htmlFor="ai-base-url">
              {t('settings.ai.baseUrl')}
            </label>
            <div className="fw-key-form">
              <input
                id="ai-base-url"
                className="field"
                type="url"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://"
                aria-invalid={!!urlError}
                aria-describedby="ai-base-url-note"
                value={urlDraft}
                onChange={(e) => {
                  setUrlDraft(e.target.value);
                  setUrlError(undefined);
                }}
              />
              <button className="btn primary" type="submit" disabled={!urlDraft.trim() || busy !== null}>
                {t('settings.ai.baseUrlSave')}
              </button>
            </div>
            {urlError ? (
              <p className="fw-caution" id="ai-base-url-note" role="alert">
                {urlError}
              </p>
            ) : (
              <p className="fw-note" id="ai-base-url-note">
                {t('settings.ai.baseUrlHint')}
              </p>
            )}
          </form>
        )}

        <ul className="fw-facts">
          <li>
            <span>
              {host ? (
                <>
                  {t('settings.ai.host')} <code>{host}</code>
                </>
              ) : (
                t('settings.ai.hostMissing')
              )}
            </span>
          </li>
          <li>{custom ? t('settings.ai.billingCustom') : t('settings.ai.billing', { provider: name })}</li>
          <li>{t('settings.ai.onDemand')}</li>
          {!supportsUrlImport(provider) && <li>{t('settings.ai.urlImportNote')}</li>}
        </ul>
        {!hardware && <p className="fw-caution">{t('settings.ai.webCaution')}</p>}

        {hasKey === undefined && <p className="fw-note">{t('settings.ai.checking')}</p>}
        {hasKey && !replacing && (
          <>
            <hr className="fw-divider" />
            <div className="row between">
              <span className="fw-status on">{t('settings.ai.keySaved')}</span>
            </div>
            <p className="fw-note">{hardware ? t('settings.ai.keySavedNative') : t('settings.ai.keySavedWeb')}</p>
            <div className="fw-actions">
              <button className="btn" disabled={busy !== null || !model || !base} onClick={test} aria-busy={busy === 'test'}>
                {busy === 'test' ? t('settings.ai.testing') : t('settings.ai.testKey')}
              </button>
              <button className="btn" disabled={busy !== null} onClick={() => setReplacing(true)}>
                {t('settings.ai.replaceKey')}
              </button>
              <button className="btn danger" disabled={busy !== null} onClick={remove}>
                {t('settings.ai.removeKey')}
              </button>
            </div>
          </>
        )}
        {showForm && (
          <form onSubmit={save}>
            <label className="fw-field-label" htmlFor="ai-key">
              {custom ? t('settings.ai.keyLabelCustom') : t('settings.ai.keyLabel', { provider: name })}
            </label>
            <div className="fw-key-form">
              <input
                id="ai-key"
                className="field"
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={anthropic ? t('settings.ai.keyPlaceholder') : t('settings.ai.keyPlaceholderOther')}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button className="btn primary" type="submit" disabled={!draft.trim() || busy !== null}>
                {busy === 'save' ? t('settings.ai.saving') : t('settings.ai.saveKey')}
              </button>
            </div>
            <p className="fw-note">{anthropic ? t('settings.ai.getKey') : custom ? t('settings.ai.getKeyCustom') : t('settings.ai.getKeyOther', { provider: name })}</p>
            {replacing && (
              <div className="fw-actions">
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    setReplacing(false);
                    setDraft('');
                  }}
                >
                  {t('common.cancel')}
                </button>
              </div>
            )}
          </form>
        )}

        <hr className="fw-divider" />
        <label className="fw-field-label" htmlFor="ai-model">
          {t('settings.ai.model')}
        </label>
        {choices.length > 0 && (
          <select
            className="field"
            style={{ marginBottom: 'var(--space-2)' }}
            aria-label={t('settings.ai.modelList')}
            value={inList ? model : ''}
            disabled={busy !== null}
            onChange={(e) => {
              if (e.target.value) setAi({ model: e.target.value });
            }}
          >
            <option value="">{model ? t('settings.ai.modelOther') : t('settings.ai.modelPick')}</option>
            {choices.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        )}
        <div className="fw-key-form">
          <input
            id="ai-model"
            className="field"
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t('settings.ai.modelIdPlaceholder')}
            value={ai.model}
            onChange={(e) => setAi({ model: e.target.value })}
            onBlur={() => {
              if (ai.model !== model) setAi({ model });
            }}
          />
          {!anthropic && (
            <button className="btn" type="button" disabled={busy !== null || !hasKey || !base} onClick={loadModels} aria-busy={busy === 'models'}>
              {busy === 'models' ? t('settings.ai.loadingModels') : t('settings.ai.loadModels')}
            </button>
          )}
        </div>
        <p className="fw-note">{model ? t('settings.ai.modelDesc') : t('settings.ai.modelNeeded')}</p>

        <div className="list">
          <SettingRow title={t('settings.ai.enable')} desc={enableDesc}>
            {canEnable || ai.enabled ? (
              <Switch checked={ai.enabled} onChange={(enabled) => setAi({ enabled: enabled && canEnable })} label={t('settings.ai.enable')} />
            ) : (
              <label className="switch" aria-label={t('settings.ai.enable')} style={{ opacity: 0.45 }}>
                <input type="checkbox" checked={false} disabled readOnly />
                <span />
              </label>
            )}
          </SettingRow>
        </div>
      </div>
    </>
  );
}

export default function SettingsPage() {
  const st = useStore();
  const s = st.settings;
  const p = st.profile;

  const changeUnit = (u: WeightUnit) => {
    if (u === s.weightUnit) return;
    const f = u === 'lb' ? LB_PER_KG : 1 / LB_PER_KG;
    const r = (v?: number) => (v === undefined ? undefined : Math.round(v * f * 10) / 10);
    useStore.setState((x) => ({
      settings: { ...x.settings, weightUnit: u },
      body: x.body.map((b) => ({ ...b, weight: r(b.weight) })),
      goals: x.goals.map((g) => ({ ...g, startWeight: r(g.startWeight)!, goalWeight: r(g.goalWeight) })),
    }));
  };

  return (
    <Page title={t('settings.title')} back>
      <div className="fw-screen">
        <h2>{t('settings.profile')}</h2>
        <div className="card list tight">
          <SettingRow title={t('settings.sex')}>
            <div style={{ width: 170 }}>
              <Seg
                value={p.sex}
                onChange={(sex) => st.setProfile({ sex })}
                options={[
                  { value: 'male', label: t('settings.sex.male') },
                  { value: 'female', label: t('settings.sex.female') },
                ]}
              />
            </div>
          </SettingRow>
          <SettingRow title={t('settings.birthYear')}>
            <div style={{ width: 104 }}>
              <NumField value={p.birthYear} ariaLabel={t('settings.birthYear')} onChange={(v) => st.setProfile({ birthYear: v ?? p.birthYear })} />
            </div>
          </SettingRow>
          <SettingRow title={s.lengthUnit === 'in' ? t('settings.heightFtIn') : t('settings.height')}>
            {s.lengthUnit === 'in' ? (
              <div className="row" style={{ gap: 6, width: 150 }}>
                <NumField
                  value={Math.floor(Math.round(p.heightCm / 2.54) / 12)}
                  ariaLabel={t('settings.heightFeet')}
                  onChange={(v) => v !== undefined && st.setProfile({ heightCm: Math.round(((v * 12) + (Math.round(p.heightCm / 2.54) % 12)) * 2.54) })}
                />
                <NumField
                  value={Math.round(p.heightCm / 2.54) % 12}
                  ariaLabel={t('settings.heightInches')}
                  onChange={(v) => v !== undefined && st.setProfile({ heightCm: Math.round((Math.floor(Math.round(p.heightCm / 2.54) / 12) * 12 + v) * 2.54) })}
                />
              </div>
            ) : (
              <div style={{ width: 104 }}>
                <NumField value={p.heightCm} ariaLabel={t('settings.height')} onChange={(v) => st.setProfile({ heightCm: v ?? p.heightCm })} />
              </div>
            )}
          </SettingRow>
          <SettingRow title={t('settings.bodyFat')} desc={t('settings.bodyFatDesc')}>
            <div style={{ width: 104 }}>
              <NumField value={p.bodyFat} step={0.5} ariaLabel={t('settings.bodyFat')} onChange={(v) => st.setProfile({ bodyFat: v })} />
            </div>
          </SettingRow>
          <SettingRow title={t('settings.activity')}>
            <select className="field" style={{ width: 160 }} aria-label={t('settings.activity')} value={p.activity} onChange={(e) => st.setProfile({ activity: e.target.value as ActivityLevel })}>
              <option value="sedentary">{t('settings.activity.sedentary')}</option>
              <option value="light">{t('settings.activity.light')}</option>
              <option value="moderate">{t('settings.activity.moderate')}</option>
              <option value="very">{t('settings.activity.very')}</option>
            </select>
          </SettingRow>
          <SettingRow title={t('settings.periodTracking')} desc={t('settings.periodTrackingDesc')}>
            <Switch checked={s.periodTracking} onChange={(periodTracking) => st.setSettings({ periodTracking })} label={t('settings.periodTracking')} />
          </SettingRow>
          <SettingRow title={t('settings.athlete')}>
            <Switch checked={p.athlete} onChange={(athlete) => st.setProfile({ athlete })} label={t('settings.athlete')} />
          </SettingRow>
          <p className="fw-note" style={{ paddingTop: 'var(--space-2)' }}>
            {t('settings.profileNote')}
          </p>
        </div>

        <h2>{t('settings.units')}</h2>
        <div className="card list tight">
          <SettingRow title={t('settings.weight')}>
            <div style={{ width: 120 }}>
              <Seg
                value={s.weightUnit}
                onChange={changeUnit}
                options={[
                  { value: 'kg', label: 'kg' },
                  { value: 'lb', label: 'lb' },
                ]}
              />
            </div>
          </SettingRow>
          <SettingRow title={t('settings.energy')}>
            <div style={{ width: 140 }}>
              <Seg
                value={s.energyUnit}
                onChange={(energyUnit) => st.setSettings({ energyUnit })}
                options={[
                  { value: 'kcal', label: 'kcal' },
                  { value: 'kJ', label: 'kJ' },
                ]}
              />
            </div>
          </SettingRow>
          <SettingRow title={t('settings.length')}>
            <div style={{ width: 140 }}>
              <Seg
                value={s.lengthUnit}
                onChange={(lengthUnit) => st.setSettings({ lengthUnit })}
                options={[
                  { value: 'cm', label: 'cm' },
                  { value: 'in', label: 'in' },
                ]}
              />
            </div>
          </SettingRow>
          <SettingRow title={t('settings.clock')}>
            <div style={{ width: 140 }}>
              <Seg
                value={s.clock}
                onChange={(clock) => st.setSettings({ clock })}
                options={[
                  { value: '24h', label: t('settings.clock.24h') },
                  { value: '12h', label: t('settings.clock.12h') },
                ]}
              />
            </div>
          </SettingRow>
          <SettingRow title={t('settings.theme')}>
            <div style={{ width: 200 }}>
              <Seg
                value={s.theme}
                onChange={(theme) => st.setSettings({ theme })}
                options={[
                  { value: 'system', label: t('settings.theme.system') },
                  { value: 'dark', label: t('settings.theme.dark') },
                  { value: 'light', label: t('settings.theme.light') },
                ]}
              />
            </div>
          </SettingRow>
          <SettingRow title={t('settings.accent')}>
            <div className="row" style={{ gap: 0 }} role="radiogroup" aria-label={t('settings.accent')}>
              {ACCENTS.map((c, i) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={s.accent === c}
                  aria-label={t('settings.accentOption', { n: i + 1 })}
                  style={{ width: 36, height: 48, display: 'grid', placeItems: 'center', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                  onClick={() => st.setSettings({ accent: c })}
                >
                  <span className="dot" style={{ width: 24, height: 24, background: c, boxShadow: s.accent === c ? '0 0 0 3px var(--color-text)' : undefined }} />
                </button>
              ))}
            </div>
          </SettingRow>
        </div>

        <h2>{t('settings.foodLog')}</h2>
        <div className="card list tight">
          <SettingRow title={t('settings.timeline')} desc={t('settings.timelineDesc')}>
            <div style={{ width: 160 }}>
              <Seg
                value={s.timeline}
                onChange={(timeline) => st.setSettings({ timeline })}
                options={[
                  { value: 'hours', label: t('settings.timeline.hours') },
                  { value: 'meals', label: t('settings.timeline.meals') },
                ]}
              />
            </div>
          </SettingRow>
          {s.timeline === 'meals' &&
            s.meals.map((m, i) => (
              <div key={i} className="row" style={{ padding: 'var(--space-2) 0', gap: 'var(--space-2)' }}>
                <input className="field" value={m.name} aria-label={t('settings.mealName')} onChange={(e) => st.setSettings({ meals: s.meals.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <input
                  className="field fw-time num"
                  type="time"
                  aria-label={t('settings.mealTime')}
                  value={minuteLabel(m.minute)}
                  onChange={(e) => {
                    const minute = parseTime(e.target.value);
                    if (minute !== undefined) st.setSettings({ meals: s.meals.map((x, j) => (j === i ? { ...x, minute } : x)) });
                  }}
                />
                <button className="icon-btn" aria-label={t('settings.removeMeal')} onClick={() => st.setSettings({ meals: s.meals.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
            ))}
          {s.timeline === 'meals' && (
            <div style={{ padding: 'var(--space-2) 0' }}>
              <button className="btn" onClick={() => st.setSettings({ meals: [...s.meals, { name: t('settings.newMeal'), minute: 15 * 60 }] })}>
                + {t('settings.addMeal')}
              </button>
            </div>
          )}
          <SettingRow title={t('settings.waterGoal')}>
            <div style={{ width: 104 }}>
              <NumField value={s.waterGoalMl} step={250} ariaLabel={t('settings.waterGoal')} onChange={(v) => st.setSettings({ waterGoalMl: v ?? 2500 })} />
            </div>
          </SettingRow>
        </div>

        <h2>{t('settings.shortcuts')}</h2>
        <div className="card list tight">
          <p className="fw-note">{t('settings.shortcutsDesc')}</p>
          {[...s.shortcuts, ...SHORTCUT_IDS.filter((id) => !s.shortcuts.includes(id))].map((id: ShortcutId) => {
            const on = s.shortcuts.includes(id);
            const i = s.shortcuts.indexOf(id);
            const move = (d: -1 | 1) => {
              const arr = [...s.shortcuts];
              const j = i + d;
              if (j < 0 || j >= arr.length) return;
              [arr[i], arr[j]] = [arr[j], arr[i]];
              st.setSettings({ shortcuts: arr });
            };
            return (
              <div key={id} className="row" style={{ padding: '6px 0', gap: 6 }}>
                <span className="grow" style={{ minWidth: 0 }}>
                  {t(`settings.shortcut.${id}`)}
                  {(id === 'describe' || id === 'snap') && !s.ai.enabled && <span className="fw-note" style={{ display: 'block', margin: 0 }}>{t('settings.shortcutNeedsAi')}</span>}
                </span>
                {on && (
                  <>
                    <button className="icon-btn" aria-label={t('dashboard.moveUp', { name: t(`settings.shortcut.${id}`) })} disabled={i === 0} onClick={() => move(-1)}>
                      ↑
                    </button>
                    <button className="icon-btn" aria-label={t('dashboard.moveDown', { name: t(`settings.shortcut.${id}`) })} disabled={i === s.shortcuts.length - 1} onClick={() => move(1)}>
                      ↓
                    </button>
                  </>
                )}
                <Switch
                  checked={on}
                  label={t(`settings.shortcut.${id}`)}
                  onChange={(v) => st.setSettings({ shortcuts: v ? [...s.shortcuts, id] : s.shortcuts.filter((x) => x !== id) })}
                />
              </div>
            );
          })}
        </div>

        <h2>{t('settings.trend')}</h2>
        <div className="card list tight">
          <SettingRow title={t('settings.smoothing')} desc={t('settings.smoothingDesc')}>
            <select className="field" style={{ width: 150 }} aria-label={t('settings.smoothing')} value={s.trendAlpha} onChange={(e) => st.setSettings({ trendAlpha: Number(e.target.value) })}>
              <option value={0.05}>{t('settings.smoothing.verySmooth')}</option>
              <option value={0.1}>{t('settings.smoothing.standard')}</option>
              <option value={0.2}>{t('settings.smoothing.responsive')}</option>
            </select>
          </SettingRow>
          <SettingRow title={t('settings.trendAlgo')} desc={s.trendRevise ? t('settings.trendAlgo.robustDesc') : t('settings.trendAlgo.simpleDesc')}>
            <select className="field" style={{ width: 150 }} aria-label={t('settings.trendAlgo')} value={s.trendRevise ? 'robust' : 'simple'} onChange={(e) => st.setSettings({ trendRevise: e.target.value === 'robust' })}>
              <option value="robust">{t('settings.trendAlgo.robust')}</option>
              <option value="simple">{t('settings.trendAlgo.simple')}</option>
            </select>
          </SettingRow>
          <SettingRow title={t('settings.projection')} desc={t(`settings.projection.${s.projection}Desc`)}>
            <select className="field" style={{ width: 150 }} aria-label={t('settings.projection')} value={s.projection} onChange={(e) => st.setSettings({ projection: e.target.value as Settings['projection'] })}>
              <option value="blend">{t('settings.projection.blend')}</option>
              <option value="data">{t('settings.projection.data')}</option>
              <option value="goal">{t('settings.projection.goal')}</option>
            </select>
          </SettingRow>
        </div>

        <h2>{t('settings.feedback')}</h2>
        <div className="card list tight">
          <SettingRow title={t('settings.haptics')} desc={t('settings.hapticsDesc')}>
            <Switch checked={s.haptics} onChange={(haptics) => st.setSettings({ haptics })} label={t('settings.haptics')} />
          </SettingRow>
        </div>

        <RemindersSection />
        <HealthSection />
        <AiSection />
      </div>
    </Page>
  );
}
