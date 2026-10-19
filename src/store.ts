import { useCallback, useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import { FOODS } from './data/foods';
import { DEFAULT_ANTHROPIC_MODEL, normalizeAiSettings } from './domain/aiProviders';
import { timeLabel } from './domain/body';
import { analyze, type CoachAnalysis } from './domain/coach';
import type { ExternalImport } from './domain/importMacroFactor';
import { mergeBody } from './domain/importMf';
import { recipeToFood } from './domain/nutrition';
import type { BodyEntry, DayMeta, Food, Goal, LogEntry, Profile, ProgressPhoto, Recipe, Settings, TargetSnapshot } from './domain/types';

/** What "Delete data" can remove, one category at a time. */
export type DataCategory = 'nutrition' | 'weight' | 'bodyFat' | 'steps' | 'measurements' | 'period' | 'photos';
import { isoDate } from './domain/util';

export const DEFAULT_SETTINGS: Settings = {
  weightUnit: 'kg',
  energyUnit: 'kcal',
  theme: 'system',
  accent: '#16a34a',
  timeline: 'hours',
  meals: [
    { name: 'Breakfast', minute: 8 * 60 },
    { name: 'Lunch', minute: 12 * 60 + 30 },
    { name: 'Dinner', minute: 19 * 60 },
    { name: 'Snacks', minute: 16 * 60 },
  ],
  trendAlpha: 0.1,
  visibleNutrients: ['fiber', 'sugar', 'satFat', 'sodium', 'potassium', 'calcium', 'iron', 'vitaminC', 'vitaminD'],
  microGoals: {},
  waterGoalMl: 2500,
  onboarded: false,
  haptics: true,
  reminders: { checkIn: true, checkInMinute: 8 * 60, weighIn: false, weighInMinute: 7 * 60 + 30, precise: false },
  health: { enabled: false, writeNutrition: true },
  ai: { enabled: false, provider: 'anthropic', model: DEFAULT_ANTHROPIC_MODEL },
  dashboard: [
    { id: 'today', visible: true },
    { id: 'expenditure', visible: true },
    { id: 'trend', visible: true },
    { id: 'goal', visible: true },
    { id: 'insights', visible: true },
    { id: 'week', visible: true },
    { id: 'habits', visible: true },
  ],
  clock: '24h',
  lengthUnit: 'cm',
  trendRevise: true,
  projection: 'blend',
  shortcuts: ['describe', 'snap', 'quickAdd', 'weighIn', 'scan', 'search'],
  periodTracking: false,
  historySort: 'recent',
};

export const DEFAULT_PROFILE: Profile = { sex: 'male', birthYear: 1995, heightCm: 178, activity: 'light', athlete: false };

export interface State {
  settings: Settings;
  profile: Profile;
  foods: Food[]; // custom + saved online foods
  recipes: Recipe[];
  favorites: string[];
  log: LogEntry[];
  meta: DayMeta[];
  body: BodyEntry[];
  photos: ProgressPhoto[];
  goals: Goal[];
  activeGoalId?: string;
  snapshots: TargetSnapshot[];
  clipboard: LogEntry[];
  /** Last serving used per food ("favorite measurement"), offered first next time. */
  servingMemory: Record<string, { label: string; qty: number }>;
  /** Daily expenditure imported from another app (MacroFactor); the estimate continues from it. */
  externalExpenditure: { date: string; kcal: number }[];
}

interface Actions {
  setSettings: (p: Partial<Settings>) => void;
  setProfile: (p: Partial<Profile>) => void;
  saveFood: (f: Food) => void;
  deleteFood: (id: string) => void;
  saveRecipe: (r: Recipe) => void;
  deleteRecipe: (id: string) => void;
  toggleFavorite: (id: string) => void;
  addEntries: (e: LogEntry[]) => void;
  updateEntry: (e: LogEntry) => void;
  deleteEntries: (ids: string[]) => void;
  /** Moves entries to another day and, when given, another time. */
  moveEntries: (ids: string[], date: string, minute?: number) => void;
  rememberServing: (foodId: string, label: string, qty: number) => void;
  deleteData: (category: DataCategory) => void;
  /**
   * Applies an import from another app. Entries, foods and goals with the same id are replaced
   * (re-importing refreshes them); weights already logged are kept. Profile and goals only when asked.
   */
  importExternal: (x: ExternalImport, opts: { profile: boolean; goals: boolean }) => void;
  copy: (e: LogEntry[]) => void;
  setMeta: (date: string, patch: Partial<DayMeta>) => void;
  saveBody: (e: BodyEntry) => void;
  addPhoto: (p: ProgressPhoto) => void;
  deletePhoto: (id: string) => void;
  startGoal: (g: Goal, first: TargetSnapshot) => void;
  updateGoal: (g: Goal) => void;
  addSnapshot: (s: TargetSnapshot) => void;
  endGoal: (id: string) => void;
  importAll: (s: Partial<State>) => void;
  resetAll: () => void;
}

const initial = (): State => ({
  settings: DEFAULT_SETTINGS,
  profile: DEFAULT_PROFILE,
  foods: [],
  recipes: [],
  favorites: [],
  log: [],
  meta: [],
  body: [],
  photos: [],
  goals: [],
  snapshots: [],
  clipboard: [],
  servingMemory: {},
  externalExpenditure: [],
});

/** Storage key used before the app was renamed from Fuelwise to Satiago. */
const LEGACY_KEY = 'fuelwise-v1';

/**
 * IndexedDB-backed storage (AD-3). On first read it takes over data saved under the old app name,
 * or left in localStorage by earlier versions (that copy is removed once IndexedDB has it).
 */
const idbStorage: StateStorage = {
  getItem: async (name) => {
    const v = await idbGet<string>(name);
    if (v != null) return v;
    const renamed = await idbGet<string>(LEGACY_KEY);
    if (renamed != null) {
      await idbSet(name, renamed);
      return renamed;
    }
    const legacy = localStorage.getItem(name) ?? localStorage.getItem(LEGACY_KEY);
    if (legacy != null) {
      await idbSet(name, legacy);
      localStorage.removeItem(name);
    }
    return legacy;
  },
  setItem: (name, value) => idbSet(name, value),
  removeItem: (name) => idbDel(name),
};

export const STORE_VERSION = 4;

/** Persisted-shape migrations; every version bump adds a step here. */
export function migrateState(persisted: unknown, from: number): Partial<State> {
  const s = (persisted ?? {}) as Partial<State>;
  if (from < 2) {
    s.settings = { ...DEFAULT_SETTINGS, ...s.settings } as Settings;
  }
  if (from < 3) {
    // v3: AI Assist gained a provider. Everything saved before used Anthropic; keep its model.
    const settings = { ...DEFAULT_SETTINGS, ...s.settings } as Settings;
    s.settings = { ...settings, ai: { ...normalizeAiSettings(settings.ai), provider: 'anthropic' } };
  }
  if (from < 4) {
    // v4: entries imported from MacroFactor's food log stored the weight of one unit (1 g) as the
    // amount; for weight units the quantity is the amount. The + menu gains "Log weight".
    const unit = (l?: string) => (l && /^(g|ml)$/i.test(l.trim()) ? 1 : l && /^oz$/i.test(l.trim()) ? 28.3495 : undefined);
    s.log = s.log?.map((e) => {
      const u = unit(e.servingLabel);
      if (!u || !e.qty || e.qty <= 0) return e;
      const grams = Math.round(e.qty * u * 100) / 100;
      return e.grams === grams ? e : { ...e, grams };
    });
    if (s.settings?.shortcuts && !s.settings.shortcuts.includes('weighIn')) s.settings = { ...s.settings, shortcuts: [...s.settings.shortcuts, 'weighIn'] };
  }
  return s;
}

/** Settings from storage or a backup, with defaults filled in and `ai` repaired. */
const withDefaults = (p?: Partial<Settings>): Settings => ({
  ...DEFAULT_SETTINGS,
  ...p,
  ai: normalizeAiSettings(p?.ai),
  // Cards added in later versions appear (visible) after the user's own arrangement.
  dashboard: [...(p?.dashboard ?? []), ...DEFAULT_SETTINGS.dashboard.filter((c) => !p?.dashboard?.some((x) => x.id === c.id))].filter((c) =>
    DEFAULT_SETTINGS.dashboard.some((d) => d.id === c.id),
  ),
});

/** Drops one field from every body entry and removes entries left with only a date. */
const stripBody = (body: BodyEntry[], key: keyof Omit<BodyEntry, 'date'>) =>
  body
    .map((b) => {
      const rest = { ...b };
      delete rest[key];
      return rest;
    })
    .filter((b) => Object.keys(b).some((k) => k !== 'date' && b[k as keyof BodyEntry] !== undefined));

const upsert = <T extends { id: string }>(arr: T[], x: T) => (arr.some((a) => a.id === x.id) ? arr.map((a) => (a.id === x.id ? x : a)) : [...arr, x]);

export const useStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      ...initial(),
      setSettings: (p) => set({ settings: { ...get().settings, ...p } }),
      setProfile: (p) => set({ profile: { ...get().profile, ...p } }),
      saveFood: (f) => set({ foods: upsert(get().foods, f) }),
      deleteFood: (id) => set({ foods: get().foods.filter((f) => f.id !== id), favorites: get().favorites.filter((x) => x !== id) }),
      saveRecipe: (r) => set({ recipes: upsert(get().recipes, r) }),
      deleteRecipe: (id) => set({ recipes: get().recipes.filter((r) => r.id !== id), favorites: get().favorites.filter((x) => x !== id) }),
      toggleFavorite: (id) => set({ favorites: get().favorites.includes(id) ? get().favorites.filter((x) => x !== id) : [...get().favorites, id] }),
      addEntries: (e) => set({ log: [...get().log, ...e] }),
      updateEntry: (e) => set({ log: get().log.map((x) => (x.id === e.id ? e : x)) }),
      deleteEntries: (ids) => set({ log: get().log.filter((x) => !ids.includes(x.id)) }),
      moveEntries: (ids, date, minute) => set({ log: get().log.map((x) => (ids.includes(x.id) ? { ...x, date, minute: minute ?? x.minute } : x)) }),
      rememberServing: (foodId, label, qty) => set({ servingMemory: { ...get().servingMemory, [foodId]: { label, qty } } }),
      importExternal: (x, opts) => {
        const s = get();
        const logIds = new Set(x.log.map((e) => e.id));
        const meta = new Map(s.meta.map((m) => [m.date, m]));
        for (const m of x.meta) {
          const cur = meta.get(m.date) ?? { date: m.date };
          meta.set(m.date, { ...cur, fasted: cur.fasted || m.fasted || undefined, partial: cur.partial || m.partial || undefined, note: cur.note || m.note });
        }
        let foods = s.foods;
        for (const f of x.foods) foods = upsert(foods, f);
        let { goals, snapshots, activeGoalId } = s;
        if (opts.goals && x.goals.length) {
          const before = new Map(s.goals.map((g) => [g.id, g]));
          // A goal imported before keeps what was set up in Satiago (diet, protein, high days…) and an end
          // the user gave it here; the export refreshes weights, rate and dates.
          const merged = x.goals.map((g) => {
            const cur = before.get(g.id);
            if (!cur) return g;
            const { diet, protein, floor, highDays, highShift, style, manual, checkInDay } = cur;
            return { ...g, diet, protein, floor, highDays, highShift, style, manual, checkInDay, endedAt: cur.endedAt ?? g.endedAt };
          });
          const gids = new Set(merged.map((g) => g.id));
          goals = [...s.goals.filter((g) => !gids.has(g.id)), ...merged];
          // Only snapshots on the same goal and day are replaced; later Satiago check-ins stay.
          const key = (sn: TargetSnapshot) => `${sn.goalId}|${sn.date}`;
          const incoming = new Set(x.snapshots.map(key));
          snapshots = [...s.snapshots.filter((sn) => !incoming.has(key(sn))), ...x.snapshots];
          const next = x.activeGoalId ? goals.find((g) => g.id === x.activeGoalId) : undefined;
          if (next && !next.endedAt && next.id !== s.activeGoalId && !(before.has(next.id) && s.activeGoalId && !gids.has(s.activeGoalId))) {
            // A newly imported current goal takes over; a different goal running in Satiago ends today.
            goals = goals.map((g) => (g.id === s.activeGoalId && !g.endedAt ? { ...g, endedAt: isoDate() } : g));
            activeGoalId = next.id;
          }
          // The export may now mark the active goal as ended.
          if (activeGoalId && goals.find((g) => g.id === activeGoalId)?.endedAt) activeGoalId = undefined;
        }
        const expDates = new Set((x.expenditure ?? []).map((k) => k.date));
        // A daily total only stands in for a day without itemized foods (from either app or file).
        const isTotal = (e: LogEntry) => e.id.includes('-total-');
        const merged = [...s.log.filter((e) => !logIds.has(e.id)), ...x.log];
        const itemizedDays = new Set(merged.filter((e) => !isTotal(e)).map((e) => e.date));
        set({
          externalExpenditure: [...s.externalExpenditure.filter((k) => !expDates.has(k.date)), ...(x.expenditure ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
          log: merged.filter((e) => !isTotal(e) || !itemizedDays.has(e.date)),
          body: mergeBody(s.body, x.body),
          meta: [...meta.values()],
          foods,
          favorites: [...new Set([...s.favorites, ...x.favorites])],
          goals,
          snapshots,
          activeGoalId,
          profile: opts.profile && x.profile ? { ...s.profile, ...x.profile } : s.profile,
          settings: {
            ...s.settings,
            ...(x.settings?.microGoals ? { microGoals: { ...s.settings.microGoals, ...x.settings.microGoals } } : {}),
            ...(opts.profile && x.settings?.projection ? { projection: x.settings.projection } : {}),
          },
        });
      },
      deleteData: (category) => {
        const s = get();
        if (category === 'nutrition') return set({ log: [], meta: s.meta.map(({ date, note }) => ({ date, note })).filter((m) => m.note), clipboard: [], externalExpenditure: [] });
        if (category === 'photos') return set({ photos: [] });
        set({ body: stripBody(s.body, category) });
      },
      copy: (e) => set({ clipboard: e }),
      setMeta: (date, patch) => {
        const cur = get().meta.find((m) => m.date === date) ?? { date };
        const next = { ...cur, ...patch };
        set({ meta: [...get().meta.filter((m) => m.date !== date), next] });
      },
      saveBody: (e) => {
        const prev = get().body.find((b) => b.date === e.date);
        const merged = { ...prev, ...e, ...(e.measurements ? { measurements: { ...prev?.measurements, ...e.measurements } } : {}) };
        set({ body: [...get().body.filter((b) => b.date !== e.date), merged].sort((a, b) => a.date.localeCompare(b.date)) });
      },
      addPhoto: (p) => set({ photos: [...get().photos, p] }),
      deletePhoto: (id) => set({ photos: get().photos.filter((p) => p.id !== id) }),
      startGoal: (g, first) =>
        set({
          goals: [...get().goals.map((x) => (x.id === get().activeGoalId && !x.endedAt ? { ...x, endedAt: isoDate() } : x)), g],
          activeGoalId: g.id,
          snapshots: [...get().snapshots.filter((s) => !(s.goalId === g.id && s.date === first.date)), first],
        }),
      updateGoal: (g) => set({ goals: upsert(get().goals, g) }),
      addSnapshot: (s) => set({ snapshots: [...get().snapshots.filter((x) => !(x.goalId === s.goalId && x.date === s.date)), s] }),
      endGoal: (id) =>
        set({ goals: get().goals.map((g) => (g.id === id ? { ...g, endedAt: isoDate() } : g)), activeGoalId: get().activeGoalId === id ? undefined : get().activeGoalId }),
      importAll: (s) => set({ ...initial(), ...s, settings: withDefaults(s.settings), profile: { ...DEFAULT_PROFILE, ...s.profile } }),
      resetAll: () => set(initial()),
    }),
    {
      name: 'satiago-v1',
      version: STORE_VERSION,
      storage: createJSONStorage(() => idbStorage),
      migrate: (p, v) => migrateState(p, v) as State & Actions,
      // New settings keys added later still get defaults without a version bump.
      merge: (p, cur) => {
        const ps = (p ?? {}) as Partial<State>;
        return { ...cur, ...ps, settings: withDefaults(ps.settings), profile: { ...DEFAULT_PROFILE, ...ps.profile } };
      },
    },
  ),
);

/** All loggable foods: built-in, custom/saved, and recipes. */
export function useFoods(): Food[] {
  const custom = useStore((s) => s.foods);
  const recipes = useStore((s) => s.recipes);
  return useMemo(() => {
    const base = [...FOODS, ...custom];
    const map = new Map(base.map((f) => [f.id, f]));
    const recipeFoods = recipes.map((r) => recipeToFood(r, (id) => map.get(id)));
    return [...base, ...recipeFoods];
  }, [custom, recipes]);
}

export function useFoodLookup() {
  const foods = useFoods();
  return useMemo(() => {
    const m = new Map(foods.map((f) => [f.id, f]));
    return (id: string) => m.get(id);
  }, [foods]);
}

export function useActiveGoal(): Goal | undefined {
  const goals = useStore((s) => s.goals);
  const id = useStore((s) => s.activeGoalId);
  return goals.find((g) => g.id === id);
}

/** Coach analysis for today; recomputed when inputs change. */
export function useAnalysis(today = isoDate()): CoachAnalysis {
  const log = useStore((s) => s.log);
  const meta = useStore((s) => s.meta);
  const body = useStore((s) => s.body);
  const profile = useStore((s) => s.profile);
  const unit = useStore((s) => s.settings.weightUnit);
  const alpha = useStore((s) => s.settings.trendAlpha);
  const revise = useStore((s) => s.settings.trendRevise);
  const known = useStore((s) => s.externalExpenditure);
  const goal = useActiveGoal();
  return useMemo(
    () => analyze({ log, meta, body, profile, unit, trendAlpha: alpha, trendRevise: revise, knownExpenditure: known, today, fallbackWeight: goal?.startWeight || (unit === 'kg' ? 75 : 165) }),
    [log, meta, body, profile, unit, alpha, revise, known, today, goal?.startWeight],
  );
}

/** Formats minutes after midnight with the user's 12/24-hour preference. */
export function useTimeLabel() {
  const clock = useStore((s) => s.settings.clock);
  return useCallback((minute: number, short = false) => timeLabel(minute, clock, short), [clock]);
}
