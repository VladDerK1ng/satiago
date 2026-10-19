/** 24 px stroke icons used in UI chrome (DESIGN.md: no emoji as UI chrome). */
const PATHS = {
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 8v8M10 8v8M13 8v8M16.5 8v8',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  pen: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  drop: 'M12 3.5s-6 6.4-6 10.9a6 6 0 0 0 12 0c0-4.5-6-10.9-6-10.9z',
  scale: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 10a4 4 0 0 1 8 0M12 10l1.6-2.2',
  copy: 'M9 9h10v10H9zM5 15V5h10',
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
