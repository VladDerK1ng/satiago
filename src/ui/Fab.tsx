import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { haptic } from '../platform/haptics';
import { useBackHandler } from './backStack';
import { motionTokens } from './motion';

export interface FabAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

/** Floating action button that springs open into a speed dial. */
export function Fab({ actions }: { actions: FabAction[] }) {
  const [open, setOpen] = useState(false);
  useBackHandler(open, () => setOpen(false));
  return (
    <>
      <AnimatePresence>
        {open && <motion.div className="fab-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />}
      </AnimatePresence>
      <div className="fab-wrap">
        <AnimatePresence>
          {open &&
            actions.map((a, i) => (
              <motion.button
                key={a.label}
                className="fab-action"
                initial={{ opacity: 0, y: 16, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1, transition: { ...motionTokens.sheet, delay: (actions.length - 1 - i) * 0.03 } }}
                exit={{ opacity: 0, y: 12, scale: 0.9, transition: motionTokens.fast }}
                onClick={() => {
                  setOpen(false);
                  a.onSelect();
                }}
              >
                <span className="fab-label">{a.label}</span>
                <span className="fab-mini" aria-hidden>
                  {a.icon}
                </span>
              </motion.button>
            ))}
        </AnimatePresence>
        <motion.button
          className="fab"
          aria-label={open ? 'Close actions' : 'Add'}
          aria-expanded={open}
          animate={{ rotate: open ? 45 : 0 }}
          transition={motionTokens.sheet}
          whileTap={{ scale: 0.92 }}
          onClick={() => {
            haptic('select');
            setOpen(!open);
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </motion.button>
      </div>
    </>
  );
}
