import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';
import { create } from 'zustand';
import { motionTokens } from './motion';

interface Snack {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}
const useSnacks = create<{ snack?: Snack; show: (s: Omit<Snack, 'id'>) => void; hide: () => void }>((set) => ({
  show: (s) => set({ snack: { ...s, id: Date.now() } }),
  hide: () => set({ snack: undefined }),
}));

/** Show a transient message, optionally with an action such as Undo. */
export const toast = (text: string, action?: Snack['action']) => useSnacks.getState().show({ text, action });

export function SnackbarHost() {
  const { snack, hide } = useSnacks();
  useEffect(() => {
    if (!snack) return;
    const t = setTimeout(hide, snack.action ? 5000 : 2600);
    return () => clearTimeout(t);
  }, [snack, hide]);
  return (
    <AnimatePresence>
      {snack && (
        <motion.div
          key={snack.id}
          className="snackbar"
          role="status"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={motionTokens.list}
        >
          <span className="grow">{snack.text}</span>
          {snack.action && (
            <button
              className="snack-action"
              onClick={() => {
                snack.action!.run();
                hide();
              }}
            >
              {snack.action.label}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
