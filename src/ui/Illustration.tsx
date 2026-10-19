import { motion } from 'motion/react';
import type { ReactNode } from 'react';

export type Scene = 'welcome' | 'empty-log' | 'empty-recipes' | 'empty-favorites' | 'check-in' | 'goal-reached' | 'offline' | 'no-results' | 'photos';

const A = 'var(--color-accent)';
// Overridable so scenes stay visible on accent-soft cards.
const S = 'var(--illus-soft, var(--color-accent-soft))';
const L = 'var(--color-text-faint)';
const P = 'var(--color-surface-raised)';
const line = { stroke: L, strokeWidth: 2.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

const scenes: Record<Scene, ReactNode> = {
  welcome: (
    <>
      <circle cx="100" cy="74" r="56" fill={S} />
      <path d="M100 26c-22 26-38 46-38 66a38 38 0 0 0 76 0c0-20-16-40-38-66z" fill={A} />
      <path d="M100 74c-8 10-14 18-14 26a14 14 0 0 0 28 0c0-8-6-16-14-26z" fill={S} />
      <path d="M40 132h120" {...line} />
      <circle cx="44" cy="38" r="4" fill={A} />
      <circle cx="160" cy="52" r="3" fill={L} />
    </>
  ),
  'empty-log': (
    <>
      <ellipse cx="100" cy="86" rx="62" ry="40" fill={S} />
      <ellipse cx="100" cy="82" rx="46" ry="28" fill={P} {...{ stroke: L, strokeWidth: 2.5 }} />
      <ellipse cx="100" cy="82" rx="28" ry="16" fill="none" stroke={A} strokeWidth="2.5" strokeDasharray="4 6" />
      <path d="M30 50v62M24 50v16a6 6 0 0 0 12 0V50" {...line} />
      <path d="M170 50c-8 0-10 14-10 24s4 12 10 12v26" {...line} />
    </>
  ),
  'empty-recipes': (
    <>
      <rect x="44" y="28" width="112" height="92" rx="12" fill={S} />
      <rect x="56" y="22" width="88" height="96" rx="10" fill={P} stroke={L} strokeWidth="2.5" />
      <path d="M72 46h56M72 62h40M72 78h48M72 94h30" {...line} />
      <circle cx="132" cy="96" r="14" fill={A} />
      <path d="M126 96h12M132 90v12" stroke="var(--color-accent-ink)" strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  'empty-favorites': (
    <>
      <circle cx="100" cy="74" r="52" fill={S} />
      <path d="M100 42l10 21 23 3-17 16 4 23-20-11-20 11 4-23-17-16 23-3z" fill={A} />
      <path d="M40 120h40M120 120h40" {...line} />
    </>
  ),
  'check-in': (
    <>
      <rect x="54" y="20" width="92" height="112" rx="14" fill={S} />
      <rect x="64" y="30" width="72" height="92" rx="10" fill={P} stroke={L} strokeWidth="2.5" />
      <rect x="84" y="22" width="32" height="14" rx="6" fill={A} />
      <path d="M78 62l8 8 14-16M78 92l8 8 14-16" stroke={A} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M108 66h16M108 96h16" {...line} />
    </>
  ),
  'goal-reached': (
    <>
      <path d="M20 128l50-70 26 34 18-22 66 58z" fill={S} />
      <path d="M70 58l26 34 18-22" {...line} />
      <path d="M114 70V24" stroke={L} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M114 24h34l-8 10 8 10h-34z" fill={A} />
      <circle cx="46" cy="40" r="4" fill={A} />
      <circle cx="160" cy="70" r="3" fill={A} />
      <circle cx="150" cy="30" r="2.5" fill={L} />
    </>
  ),
  offline: (
    <>
      <path d="M58 104h86a26 26 0 0 0 0-52 36 36 0 0 0-68-6 28 28 0 0 0-18 58z" fill={S} />
      <path d="M58 104h86a26 26 0 0 0 0-52 36 36 0 0 0-68-6 28 28 0 0 0-18 58z" {...line} />
      <path d="M60 128L146 30" stroke={A} strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  'no-results': (
    <>
      <circle cx="90" cy="68" r="46" fill={S} />
      <circle cx="90" cy="68" r="30" fill={P} stroke={L} strokeWidth="2.5" />
      <path d="M112 90l28 28" stroke={A} strokeWidth="6" strokeLinecap="round" />
      <path d="M80 60c0-6 4-10 10-10s10 4 10 10-10 8-10 14M90 84v1" stroke={A} strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </>
  ),
  photos: (
    <>
      <rect x="38" y="36" width="124" height="88" rx="16" fill={S} />
      <rect x="50" y="46" width="100" height="70" rx="12" fill={P} stroke={L} strokeWidth="2.5" />
      <circle cx="100" cy="81" r="18" fill="none" stroke={A} strokeWidth="3" />
      <circle cx="100" cy="81" r="7" fill={A} />
      <rect x="84" y="36" width="32" height="12" rx="5" fill={L} />
    </>
  ),
};

/** Original two-tone illustrations for empty states and moments (DESIGN.md · Illustrations). */
export function Illustration({ scene, size = 180, title }: { scene: Scene; size?: number; title?: string }) {
  return (
    <motion.svg
      viewBox="0 0 200 140"
      width={size}
      height={(size * 140) / 200}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {scenes[scene]}
    </motion.svg>
  );
}

export function EmptyState({ scene, title, children }: { scene: Scene; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Illustration scene={scene} />
      <div className="empty-title">{title}</div>
      {children}
    </div>
  );
}
