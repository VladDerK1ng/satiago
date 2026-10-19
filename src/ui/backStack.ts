import { useEffect, useRef } from 'react';

/** Overlays (sheets, dialogs, scanner) register here so the Android back button closes them first. */
const stack: { id: number; close: () => void }[] = [];
let seq = 0;

export function closeTopOverlay(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export function useBackHandler(active: boolean, close: () => void) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!active) return;
    const id = ++seq;
    stack.push({ id, close: () => ref.current() });
    return () => {
      const i = stack.findIndex((x) => x.id === id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
