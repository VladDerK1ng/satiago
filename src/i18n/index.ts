import { en } from './en';

export type StringKey = keyof typeof en;

/** Look up a user-facing string (AD-12). `{name}` placeholders are filled from `vars`. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  // A "<key>#one" entry is the singular form, used when vars.count is 1.
  const one = vars?.count === 1 ? (en as Record<string, string>)[`${key}#one`] : undefined;
  const s: string = one ?? en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : s;
}
