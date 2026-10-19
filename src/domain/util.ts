export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const pad = (n: number) => String(n).padStart(2, '0');

export const isoDate = (d: Date | number = new Date()): string => {
  const x = typeof d === 'number' ? new Date(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

/** Monday-based start of week, local time. */
export const startOfWeek = (d: Date | number = new Date()): Date => {
  const x = new Date(typeof d === 'number' ? d : d.getTime());
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
};

export const addDays = (d: Date, n: number): Date => {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
};

export const round = (n: number, step = 1): number => Math.round(n / step) * step;

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const fmtDuration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
};

export const fmtNum = (n: number | undefined, digits = 1): string =>
  n === undefined || Number.isNaN(n) ? '–' : String(Number(n.toFixed(digits)));

export const KG_PER_LB = 0.45359237;
