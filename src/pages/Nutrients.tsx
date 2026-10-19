import { useMemo, useState } from 'react';
import { Bar, BarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { NumField, Page, Seg, Sheet } from '../components/ui';
import { targetFor } from '../domain/coach';
import { NUTRIENT_META, dayTotals } from '../domain/nutrition';
import { dayIndex, fromIndex } from '../domain/trend';
import type { NutrientKey } from '../domain/types';
import { fmtNum, isoDate } from '../domain/util';
import { useActiveGoal, useStore } from '../store';
import { tooltipStyle } from './Dashboard';

const GROUPS = ['Macros', 'Carbs', 'Fats', 'Minerals', 'Vitamins', 'Other'] as const;

export default function Nutrients() {
  const st = useStore();
  const goal = useActiveGoal();
  const [days, setDays] = useState(7);
  const [focus, setFocus] = useState<NutrientKey | null>(null);
  const today = isoDate();

  const dates = useMemo(() => Array.from({ length: days }, (_, i) => fromIndex(dayIndex(today) - days + 1 + i)), [days, today]);
  const logged = useMemo(() => dates.filter((d) => st.log.some((e) => e.date === d)), [dates, st.log]);
  const avg = useMemo(() => {
    const tot = dayTotals(st.log.filter((e) => logged.includes(e.date)));
    const out: Partial<Record<NutrientKey, number>> = {};
    for (const k of Object.keys(tot) as NutrientKey[]) out[k] = (tot[k] ?? 0) / Math.max(1, logged.length);
    return out;
  }, [st.log, logged]);

  const macroTarget = (k: NutrientKey) => {
    const ts = logged.map((d) => targetFor(d, goal, st.snapshots)).filter((t) => !!t);
    if (!ts.length || !['kcal', 'protein', 'carbs', 'fat'].includes(k)) return undefined;
    return ts.reduce((t, x) => t + (x as unknown as Record<string, number>)[k], 0) / ts.length;
  };
  const goalOf = (k: NutrientKey) => {
    const custom = st.settings.microGoals[k];
    return { target: custom?.target ?? macroTarget(k) ?? NUTRIENT_META[k].target, ceiling: custom?.ceiling ?? NUTRIENT_META[k].ceiling };
  };

  const series = useMemo(() => {
    if (!focus) return [];
    return dates.map((d) => ({ date: d.slice(5), value: Math.round((dayTotals(st.log.filter((e) => e.date === d))[focus] ?? 0) * 10) / 10 }));
  }, [focus, dates, st.log]);
  const contributors = useMemo(() => {
    if (!focus) return [];
    const m = new Map<string, { name: string; icon: string; v: number }>();
    for (const e of st.log) {
      if (!logged.includes(e.date)) continue;
      const v = e.n[focus] ?? 0;
      if (!v) continue;
      const cur = m.get(e.name) ?? { name: e.name, icon: e.icon, v: 0 };
      cur.v += v;
      m.set(e.name, cur);
    }
    return [...m.values()].sort((a, b) => b.v - a.v).slice(0, 6);
  }, [focus, st.log, logged]);

  return (
    <Page title="Nutrients">
      <Seg value={days} onChange={setDays} options={[{ value: 1, label: 'Today' }, { value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }]} />
      <p className="muted small">
        Daily averages over {logged.length} logged day{logged.length === 1 ? '' : 's'}. Unlogged days are skipped. Tap a nutrient for details.
      </p>
      {GROUPS.map((g) => {
        const keys = (Object.keys(NUTRIENT_META) as NutrientKey[]).filter((k) => NUTRIENT_META[k].group === g || (g === 'Macros' && k === 'kcal'));
        return (
          <section key={g}>
            <h2>{g}</h2>
            <div className="card list tight">
              {keys.map((k) => {
                const meta = NUTRIENT_META[k];
                const v = avg[k] ?? 0;
                const { target, ceiling } = goalOf(k);
                const ref = target ?? ceiling;
                const pct = ref ? Math.min(100, (v / ref) * 100) : 0;
                const over = ceiling !== undefined && v > ceiling;
                return (
                  <button key={k} className="item" style={{ display: 'block' }} onClick={() => setFocus(k)}>
                    <div className="row between small">
                      <span>{meta.label}</span>
                      <span>
                        <b>{fmtNum(v, v < 10 ? 1 : 0)}</b> {meta.unit}
                        {ref ? <span className="muted"> / {fmtNum(ref, 0)} {target ? '' : 'max'}</span> : null}
                      </span>
                    </div>
                    {ref ? (
                      <div className={`bar ${over ? 'over' : ''}`} style={{ marginTop: 4 }}>
                        <div style={{ width: `${pct}%`, background: target && v >= target ? 'var(--good)' : undefined }} />
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      <Sheet open={!!focus} onClose={() => setFocus(null)} title={focus ? NUTRIENT_META[focus].label : ''}>
        {focus && (
          <>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={series} margin={{ left: -14, right: 4, top: 10 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} minTickGap={16} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--surface-2)' }} />
                {goalOf(focus).target && <ReferenceLine y={goalOf(focus).target} stroke="var(--good)" strokeDasharray="4 4" />}
                {goalOf(focus).ceiling && <ReferenceLine y={goalOf(focus).ceiling} stroke="var(--bad)" strokeDasharray="4 4" />}
                <Bar dataKey="value" name={NUTRIENT_META[focus].unit} fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <h3>Top sources</h3>
            {contributors.length === 0 && <div className="muted small">No logged foods contain this nutrient in the period.</div>}
            {contributors.map((c) => (
              <div key={c.name} className="row between small" style={{ padding: '4px 0' }}>
                <span className="ellipsis">
                  {c.icon} {c.name}
                </span>
                <b>
                  {fmtNum(c.v)} {NUTRIENT_META[focus].unit}
                </b>
              </div>
            ))}
            {!['kcal', 'protein', 'carbs', 'fat'].includes(focus) && (
              <>
                <h3 style={{ marginTop: 14 }}>Your goal</h3>
                <div className="grid2">
                  <div>
                    <label className="lbl">Target ({NUTRIENT_META[focus].unit})</label>
                    <NumField
                      value={st.settings.microGoals[focus]?.target ?? NUTRIENT_META[focus].target}
                      onChange={(v) => st.setSettings({ microGoals: { ...st.settings.microGoals, [focus]: { ...st.settings.microGoals[focus], target: v } } })}
                    />
                  </div>
                  <div>
                    <label className="lbl">Ceiling ({NUTRIENT_META[focus].unit})</label>
                    <NumField
                      value={st.settings.microGoals[focus]?.ceiling ?? NUTRIENT_META[focus].ceiling}
                      onChange={(v) => st.setSettings({ microGoals: { ...st.settings.microGoals, [focus]: { ...st.settings.microGoals[focus], ceiling: v } } })}
                    />
                  </div>
                </div>
                <p className="muted tiny">Defaults are general adult reference intakes. Individual needs vary.</p>
              </>
            )}
          </>
        )}
      </Sheet>
    </Page>
  );
}
