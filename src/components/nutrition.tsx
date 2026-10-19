import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { NUTRIENT_META, fmtEnergy } from '../domain/nutrition';
import type { Food, MacroTarget, NutrientKey, Nutrients } from '../domain/types';
import { fmtNum } from '../domain/util';
import { t, type StringKey } from '../i18n';
import { useStore } from '../store';
import { Ticker } from '../ui/Ticker';
import { motionTokens } from '../ui/motion';
import '../styles/food.css';

type MacroKey = 'kcal' | 'protein' | 'fat' | 'carbs';
const MACROS: { key: MacroKey; label: StringKey; unit: string }[] = [
  { key: 'kcal', label: 'food.macro.kcal', unit: '' },
  { key: 'protein', label: 'food.macro.protein', unit: 'g' },
  { key: 'fat', label: 'food.macro.fat', unit: 'g' },
  { key: 'carbs', label: 'food.macro.carbs', unit: 'g' },
];

/** Consumed vs target for calories and macros. `mode` switches remaining/consumed display with a number roll. */
export function MacroSummary({ totals, target, mode = 'remaining' }: { totals: Nutrients; target?: MacroTarget; mode?: 'remaining' | 'consumed' }) {
  const eu = useStore((s) => s.settings.energyUnit);
  return (
    <div className="macro-grid">
      {MACROS.map((m) => {
        const val = totals[m.key] ?? 0;
        const tgt = target?.[m.key];
        const pct = tgt ? Math.min(100, (val / tgt) * 100) : 0;
        const over = tgt !== undefined && val > tgt * 1.05;
        const fmt = (v: number) => (m.key === 'kcal' ? fmtEnergy(v, eu) : `${Math.round(v)}${m.unit}`);
        const remaining = mode === 'remaining' && tgt !== undefined;
        const shown = remaining ? tgt - val : val;
        const label = m.key === 'kcal' && eu === 'kJ' ? 'kJ' : t(m.label);
        const caption =
          tgt === undefined
            ? t('food.macro.noTarget')
            : remaining
              ? shown < 0
                ? t('food.macro.overOf', { target: fmt(tgt) })
                : t('food.macro.leftOf', { target: fmt(tgt) })
              : t('food.macro.of', { target: fmt(tgt) });
        return (
          <div key={m.key} className={`macro c-${m.key}${over ? ' is-over' : ''}`}>
            <span className="sub">{label}</span>
            <Ticker className="val num" value={remaining ? Math.abs(shown) : shown} format={fmt} />
            <div className={`bar ${over ? 'over' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
              <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={motionTokens.slow} />
            </div>
            <span className={`sub${remaining && shown < 0 ? ' caution' : ''}`}>{caption}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Compact animated kcal / P / F / C totals (food sheet, AI review). */
export function MacroStrip({ n }: { n: Nutrients }) {
  const eu = useStore((s) => s.settings.energyUnit);
  const summary = t('food.macro.summary', {
    kcal: fmtEnergy(n.kcal ?? 0, eu),
    unit: eu,
    p: Math.round(n.protein ?? 0),
    f: Math.round(n.fat ?? 0),
    c: Math.round(n.carbs ?? 0),
  });
  return (
    <div className="macro-strip" role="group" aria-label={summary}>
      {MACROS.map((m) => (
        <div key={m.key} className={`ms c-${m.key}`} aria-hidden>
          <Ticker className="ms-val num" value={n[m.key] ?? 0} format={m.key === 'kcal' ? (v) => fmtEnergy(v, eu) : (v) => `${Math.round(v)}g`} />
          {/* Unit lives in the value so the label fits narrow tiles. */}
          <span className="ms-lbl">{m.key === 'kcal' ? eu : t(m.label)}</span>
        </div>
      ))}
    </div>
  );
}

const LABEL_ROWS: { key: NutrientKey; indent?: boolean; strong?: boolean }[] = [
  { key: 'fat', strong: true },
  { key: 'satFat', indent: true },
  { key: 'transFat', indent: true },
  { key: 'monoFat', indent: true },
  { key: 'polyFat', indent: true },
  { key: 'cholesterol', strong: true },
  { key: 'sodium', strong: true },
  { key: 'carbs', strong: true },
  { key: 'fiber', indent: true },
  { key: 'sugar', indent: true },
  { key: 'addedSugar', indent: true },
  { key: 'protein', strong: true },
];

export function NutritionLabel({ n, showMicros = true }: { n: Nutrients; showMicros?: boolean }) {
  const eu = useStore((s) => s.settings.energyUnit);
  const micros = (Object.keys(NUTRIENT_META) as NutrientKey[]).filter(
    (k) => ['Minerals', 'Vitamins', 'Other'].includes(NUTRIENT_META[k].group) && k !== 'sodium' && n[k] !== undefined,
  );
  return (
    <table className="label-table num">
      <tbody>
        <tr className="strong">
          <td>{eu === 'kJ' ? t('food.label.energyKj') : t('food.macro.kcal')}</td>
          <td>{fmtEnergy(n.kcal ?? 0, eu)}</td>
        </tr>
        {LABEL_ROWS.filter((r) => n[r.key] !== undefined || r.strong).map((r) => (
          <tr key={r.key} className={r.indent ? 'indent' : r.strong ? 'strong' : ''}>
            <td>{NUTRIENT_META[r.key].label}</td>
            <td>
              {fmtNum(n[r.key] ?? 0, 1)} {NUTRIENT_META[r.key].unit}
            </td>
          </tr>
        ))}
        {showMicros &&
          micros.map((k) => (
            <tr key={k} className="indent">
              <td>{NUTRIENT_META[k].label}</td>
              <td>
                {fmtNum(n[k], NUTRIENT_META[k].unit === 'mg' && (n[k] ?? 0) < 10 ? 2 : 1)} {NUTRIENT_META[k].unit}
                {NUTRIENT_META[k].target ? <span className="muted"> · {Math.round(((n[k] ?? 0) / NUTRIENT_META[k].target!) * 100)}%</span> : null}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

export function FoodRow({ f, onClick, right }: { f: Food; onClick?: () => void; right?: ReactNode }) {
  const eu = useStore((s) => s.settings.energyUnit);
  const s = f.servings[0];
  const k = ((f.per100.kcal ?? 0) * (s?.grams ?? 100)) / 100;
  const p = ((f.per100.protein ?? 0) * (s?.grams ?? 100)) / 100;
  const fat = ((f.per100.fat ?? 0) * (s?.grams ?? 100)) / 100;
  const c = ((f.per100.carbs ?? 0) * (s?.grams ?? 100)) / 100;
  const main = (
    <>
      <span className="thumb" aria-hidden>
        {f.icon}
      </span>
      <span className="grow" style={{ minWidth: 0 }}>
        <div className="ellipsis" style={{ fontWeight: 600 }}>
          {f.name}
        </div>
        <div className="muted small ellipsis num">
          {f.brand ? `${f.brand} · ` : ''}
          {s?.label} · {fmtEnergy(k, eu)} {eu} · P{Math.round(p)} F{Math.round(fat)} C{Math.round(c)}
          {f.source === 'openfoodfacts' ? ` · ${t('food.source.off')}` : ''}
        </div>
      </span>
    </>
  );
  // A trailing control (e.g. a favorite star) must not nest inside the row button.
  if (right)
    return (
      <div className="item food-row-split">
        <button className="food-row-main" onClick={onClick}>
          {main}
        </button>
        {right}
      </div>
    );
  return (
    <button className="item" onClick={onClick}>
      {main}
    </button>
  );
}

export const macroLine = (n: Nutrients) => `P${Math.round(n.protein ?? 0)} F${Math.round(n.fat ?? 0)} C${Math.round(n.carbs ?? 0)}`;
