import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBackHandler } from './backStack';
import { motionTokens } from './motion';

/** Bottom sheet with spring entry, drag-to-dismiss from the handle, scrim and back-button support. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const drag = useDragControls();
  useBackHandler(open, onClose);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="sheet-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTokens.fast}
          onClick={onClose}
        >
          <motion.div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={motionTokens.sheet}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.9 }}
            onDragEnd={onDragEnd}
          >
            <div className="grab-zone" onPointerDown={(e) => drag.start(e)} aria-hidden>
              <div className="grab" />
            </div>
            {title && <h2 className="sheet-title">{title}</h2>}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
