import type { Transition } from 'motion/react';

/** Motion tokens (EXPERIENCE.md · Interaction Primitives, AD-10). */
export const ease = [0.2, 0.8, 0.2, 1] as const;
export const motionTokens = {
  fast: { duration: 0.14, ease: 'easeOut' } satisfies Transition,
  base: { duration: 0.22, ease } satisfies Transition,
  slow: { duration: 0.38, ease } satisfies Transition,
  sheet: { type: 'spring', stiffness: 420, damping: 40 } satisfies Transition,
  list: { type: 'spring', stiffness: 320, damping: 30 } satisfies Transition,
};
export const stagger = (i: number) => Math.min(i, 8) * 0.03;

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
