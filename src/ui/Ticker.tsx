import { animate, useMotionValue, useTransform, motion } from 'motion/react';
import { useEffect } from 'react';
import { prefersReducedMotion } from './motion';

/** Animated number that rolls between values (tabular numerals keep width stable). */
export function Ticker({ value, format = (v) => String(Math.round(v)), className }: { value: number; format?: (v: number) => string; className?: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    if (prefersReducedMotion()) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] });
    return () => c.stop();
  }, [value, mv]);
  return <motion.span className={className}>{text}</motion.span>;
}
