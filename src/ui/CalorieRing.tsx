import { motion } from 'motion/react';
import type { MacroTarget, Nutrients } from '../domain/types';
import { Ticker } from './Ticker';
import { motionTokens } from './motion';

const arc = (r: number) => 2 * Math.PI * r;

/** Dashboard hero: calories remaining with an accent arc and thin macro rings inside. */
export function CalorieRing({ totals, target, energyLabel, toDisplay }: { totals: Nutrients; target?: MacroTarget; energyLabel: string; toDisplay: (kcal: number) => number }) {
  const rings = [
    { key: 'kcal' as const, r: 88, w: 14, color: 'var(--color-accent)' },
    { key: 'protein' as const, r: 70, w: 6, color: 'var(--color-protein)' },
    { key: 'fat' as const, r: 61, w: 6, color: 'var(--color-fat)' },
    { key: 'carbs' as const, r: 52, w: 6, color: 'var(--color-carbs)' },
  ];
  const kcal = totals.kcal ?? 0;
  const remaining = target ? target.kcal - kcal : kcal;
  return (
    <div className="ring-wrap">
      <svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label={`${Math.round(toDisplay(Math.abs(remaining)))} ${energyLabel} ${target ? (remaining >= 0 ? 'remaining' : 'over') : 'eaten'}`}>
        {rings.map((g) => {
          const val = totals[g.key] ?? 0;
          const t = target?.[g.key];
          const pct = t ? Math.min(1, val / t) : 0;
          const c = arc(g.r);
          return (
            <g key={g.key} transform="rotate(-90 100 100)">
              <circle cx="100" cy="100" r={g.r} fill="none" stroke="var(--color-surface-sunken)" strokeWidth={g.w} />
              <motion.circle
                cx="100"
                cy="100"
                r={g.r}
                fill="none"
                stroke={g.key === 'kcal' && t && val > t * 1.05 ? 'var(--color-caution)' : g.color}
                strokeWidth={g.w}
                strokeLinecap="round"
                strokeDasharray={c}
                initial={{ strokeDashoffset: c }}
                animate={{ strokeDashoffset: c * (1 - pct) }}
                transition={motionTokens.slow}
              />
            </g>
          );
        })}
      </svg>
      <div className="ring-center">
        <Ticker className="ring-value" value={toDisplay(Math.abs(remaining))} />
        <span className="overline">{target ? (remaining >= 0 ? `${energyLabel} left` : `${energyLabel} over`) : `${energyLabel} eaten`}</span>
      </div>
    </div>
  );
}
