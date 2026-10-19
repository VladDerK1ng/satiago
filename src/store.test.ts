import { describe, expect, it, vi } from 'vitest';

// The store persists to IndexedDB; tests run in Node, so keep it in memory.
vi.mock('idb-keyval', () => {
  const m = new Map<string, unknown>();
  return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => void m.set(k, v), del: async (k: string) => void m.delete(k) };
});
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
import type { Settings } from './domain/types';
import { DEFAULT_SETTINGS, STORE_VERSION, migrateState } from './store';

describe('store migrations', () => {
  it('is at version 4', () => {
    expect(STORE_VERSION).toBe(4);
  });

  it('v3 → v4 repairs imported amounts stored as the per-unit weight and adds the weigh-in shortcut', () => {
    const e = (id: string, servingLabel: string | undefined, qty: number | undefined, grams: number | undefined) => ({ id, date: '2026-10-18', minute: 600, name: id, icon: '', servingLabel, qty, grams, n: { kcal: 100 } });
    const s = migrateState(
      {
        settings: { ...DEFAULT_SETTINGS, shortcuts: ['search', 'scan'] },
        log: [e('walnuts', 'g', 15, 1), e('milk', 'ml', 250, 1), e('cheese', 'oz', 2, 28.3495), e('cup', '1 cup', 2, 240), e('ok', 'g', 80, 80)],
      },
      3,
    );
    expect(s.log!.map((x) => x.grams)).toEqual([15, 250, 56.7, 240, 80]);
    expect(s.settings!.shortcuts).toEqual(['search', 'scan', 'weighIn']);
  });

  it('v2 → v3 sets the AI provider to Anthropic and keeps the model and switch', () => {
    const v2 = { settings: { ...DEFAULT_SETTINGS, energyUnit: 'kJ', ai: { enabled: true, model: 'claude-sonnet-5-5' } }, log: [] };
    const s = migrateState(v2, 2);
    expect(s.settings?.ai).toEqual({ enabled: true, provider: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(s.settings?.energyUnit).toBe('kJ');
    expect(s.log).toEqual([]);
  });

  it('v1 → v3 fills settings defaults and the Anthropic provider', () => {
    const s = migrateState({ settings: { weightUnit: 'lb' } }, 1);
    expect(s.settings?.weightUnit).toBe('lb');
    expect(s.settings?.ai).toEqual({ enabled: false, provider: 'anthropic', model: 'claude-opus-5-5' });
  });

  it('leaves v3 data alone', () => {
    const ai: Settings['ai'] = { enabled: true, provider: 'groq', model: 'some-model' };
    const s = migrateState({ settings: { ...DEFAULT_SETTINGS, ai } }, 3);
    expect(s.settings?.ai).toEqual(ai);
  });

  it('defaults new installs to Anthropic with Opus', () => {
    expect(DEFAULT_SETTINGS.ai).toEqual({ enabled: false, provider: 'anthropic', model: 'claude-opus-5-5' });
  });
});

describe('store actions', () => {
  it('importAll adds dashboard cards that older data lacks and drops unknown ones', async () => {
    const { useStore } = await import('./store');
    const old = DEFAULT_SETTINGS.dashboard.filter((c) => c.id !== 'insights').map((c) => (c.id === 'week' ? { ...c, visible: false } : c));
    useStore.getState().importAll({ settings: { ...DEFAULT_SETTINGS, dashboard: [...old, { id: 'gone' as never, visible: true }] } });
    const ids = useStore.getState().settings.dashboard;
    expect(ids.map((c) => c.id)).toEqual([...old.map((c) => c.id), 'insights']);
    expect(ids.find((c) => c.id === 'week')?.visible).toBe(false);
  });

  it('deleteData removes one category and keeps the rest', async () => {
    const { useStore } = await import('./store');
    useStore.getState().importAll({
      body: [
        { date: '2026-10-01', weight: 80, measurements: { waist: 90 } },
        { date: '2026-10-02', weight: 79.5 },
      ],
    });
    useStore.getState().deleteData('weight');
    expect(useStore.getState().body).toEqual([{ date: '2026-10-01', measurements: { waist: 90 } }]);
  });

  it('moveEntries changes day and time, saveBody merges measurements', async () => {
    const { useStore } = await import('./store');
    useStore.getState().importAll({ log: [{ id: 'a', date: '2026-10-01', minute: 480, name: 'Egg', icon: '', n: { kcal: 70 } }] });
    useStore.getState().moveEntries(['a'], '2026-10-03', 600);
    expect(useStore.getState().log[0]).toMatchObject({ date: '2026-10-03', minute: 600 });
    useStore.getState().saveBody({ date: '2026-10-05', measurements: { waist: 90 } });
    useStore.getState().saveBody({ date: '2026-10-05', measurements: { hips: 100 } });
    expect(useStore.getState().body.find((b) => b.date === '2026-10-05')?.measurements).toEqual({ waist: 90, hips: 100 });
  });
});

describe('importExternal', () => {
  const base = {
    log: [{ id: 'macrofactor-total-2026-01-18', date: '2026-01-18', minute: 720, name: 'MacroFactor daily total', icon: '', n: { kcal: 2000, protein: 130, fiber: 30 } }],
    body: [{ date: '2026-01-18', weight: 80 }],
    meta: [{ date: '2026-01-19', fasted: true }],
    foods: [{ id: 'macrofactor-food-cheese', name: 'Cheese', icon: '', category: 'Packaged', per100: { kcal: 325 }, servings: [{ label: '40 g', grams: 40 }], source: 'custom' as const }],
    favorites: ['macrofactor-food-cheese'],
    goals: [{ id: 'macrofactor-goal-2026-01-15', type: 'lose' as const, startDate: '2026-01-15', startWeight: 80, goalWeight: 75, ratePct: 0.5, style: 'coached' as const, diet: 'balanced' as const, protein: 'moderate' as const, floor: 'standard' as const, highDays: [], highShift: 0, checkInDay: 6 }],
    snapshots: [],
    activeGoalId: 'macrofactor-goal-2026-01-15',
    profile: { sex: 'female' as const, heightCm: 168 },
    summary: { days: 1, dailyTotals: 1, expenditure: 0, foodEntries: 0, weights: 1, bodyFat: 0, steps: 0, measurements: 0, flags: 1, notes: 0, foods: 1, recipes: 0, goals: 1, targets: 0, skipped: 0, ignored: [] },
    warnings: [],
  };

  it('replaces earlier imported totals instead of duplicating, and keeps weights logged in the app', async () => {
    const { useStore } = await import('./store');
    useStore.getState().importAll({
      log: [{ id: 'macrofactor-total-2026-01-18', date: '2026-01-18', minute: 720, name: 'MacroFactor daily total', icon: '', n: { kcal: 2000 } }],
      body: [{ date: '2026-01-18', weight: 79.5 }],
    });
    useStore.getState().importExternal(base, { profile: false, goals: false });
    const s = useStore.getState();
    expect(s.log).toHaveLength(1);
    expect(s.log[0].n.fiber).toBe(30);
    expect(s.body[0].weight).toBe(79.5);
    expect(s.meta).toEqual([{ date: '2026-01-19', fasted: true }]);
    expect(s.favorites).toEqual(['macrofactor-food-cheese']);
    expect(s.profile.sex).toBe(DEFAULT_SETTINGS && 'male');
    expect(s.goals).toEqual([]);
  });

  it('applies profile and makes the imported goal active when asked', async () => {
    const { useStore } = await import('./store');
    useStore.getState().importAll({});
    useStore.getState().importExternal(base, { profile: true, goals: true });
    const s = useStore.getState();
    expect(s.profile).toMatchObject({ sex: 'female', heightCm: 168 });
    expect(s.activeGoalId).toBe('macrofactor-goal-2026-01-15');
  });
});

describe('importExternal goal merging (code review)', () => {
  const goal = { id: 'macrofactor-goal-2026-01-15', type: 'lose' as const, startDate: '2026-01-15', startWeight: 80, goalWeight: 75, ratePct: 0.5, style: 'coached' as const, diet: 'balanced' as const, protein: 'moderate' as const, floor: 'standard' as const, highDays: [] as number[], highShift: 0, checkInDay: 6 };
  const t = (kcal: number) => Array.from({ length: 7 }, () => ({ kcal, protein: 150, carbs: 200, fat: 60 }));
  const snap = (date: string, kcal: number) => ({ date, goalId: goal.id, expenditure: 2500, targets: t(kcal), reason: '' });
  const payload = (g = goal, active: string | undefined = goal.id) => ({
    log: [], body: [], meta: [], foods: [], favorites: [], goals: [g], snapshots: [snap('2026-01-18', 2000)], activeGoalId: active,
    summary: { days: 0, dailyTotals: 0, expenditure: 0, foodEntries: 0, weights: 0, bodyFat: 0, steps: 0, measurements: 0, flags: 0, notes: 0, foods: 0, recipes: 0, goals: 1, targets: 1, skipped: 0, ignored: [] },
    warnings: [],
  });

  it('keeps check-ins and goal settings made in Satiago after the first import', async () => {
    const { useStore } = await import('./store');
    useStore.getState().importAll({});
    useStore.getState().importExternal(payload(), { profile: false, goals: true });
    useStore.getState().addSnapshot(snap('2026-01-25', 1900));
    useStore.getState().updateGoal({ ...goal, diet: 'lowCarb', protein: 'high', highDays: [5] });
    useStore.getState().importExternal(payload(), { profile: false, goals: true });
    const s = useStore.getState();
    expect(s.snapshots.map((x) => x.date).sort()).toEqual(['2026-01-18', '2026-01-25']);
    expect(s.goals.find((g) => g.id === goal.id)).toMatchObject({ diet: 'lowCarb', protein: 'high', highDays: [5] });
  });

  it('does not bring back a goal the user ended in Satiago', async () => {
    const { useStore } = await import('./store');
    useStore.getState().importAll({});
    useStore.getState().importExternal(payload(), { profile: false, goals: true });
    useStore.getState().endGoal(goal.id);
    const own = { ...goal, id: 'mine', startDate: '2026-02-01' };
    useStore.getState().startGoal(own, { ...snap('2026-02-01', 1800), goalId: 'mine' });
    useStore.getState().importExternal(payload(), { profile: false, goals: true });
    const s = useStore.getState();
    expect(s.activeGoalId).toBe('mine');
    expect(s.goals.find((g) => g.id === goal.id)?.endedAt).toBeTruthy();
    expect(s.goals.find((g) => g.id === 'mine')?.endedAt).toBeUndefined();
  });

  it('clears the active goal when the export marks it ended', async () => {
    const { useStore } = await import('./store');
    useStore.getState().importAll({});
    useStore.getState().importExternal(payload(), { profile: false, goals: true });
    useStore.getState().importExternal(payload({ ...goal, endedAt: '2026-03-01' } as typeof goal, undefined), { profile: false, goals: true });
    const s = useStore.getState();
    expect(s.goals.find((g) => g.id === goal.id)?.endedAt).toBe('2026-03-01');
    expect(s.activeGoalId).toBeUndefined();
  });
});

describe('itemized foods vs daily totals', () => {
  const summary = { days: 0, dailyTotals: 0, expenditure: 0, foodEntries: 0, weights: 0, bodyFat: 0, steps: 0, measurements: 0, flags: 0, notes: 0, foods: 0, recipes: 0, goals: 0, targets: 0, skipped: 0, ignored: [] };
  const pack = (log: { id: string; date: string }[]) => ({
    log: log.map((e) => ({ ...e, minute: 600, name: e.id, icon: '', n: { kcal: 500 } })),
    body: [], meta: [], foods: [], favorites: [], goals: [], snapshots: [], summary, warnings: [],
  });
  it('never keeps a daily total on a day that has itemized foods, whichever file comes first', async () => {
    const { useStore } = await import('./store');
    // Food log export first, then the all-data export with totals.
    useStore.getState().importAll({});
    useStore.getState().importExternal(pack([{ id: 'macrofactor-Food Log-2026-10-18-1', date: '2026-10-18' }]), { profile: false, goals: false });
    useStore.getState().importExternal(pack([{ id: 'macrofactor-total-2026-10-18', date: '2026-10-18' }, { id: 'macrofactor-total-2026-10-17', date: '2026-10-17' }]), { profile: false, goals: false });
    expect(useStore.getState().log.map((e) => e.id).sort()).toEqual(['macrofactor-Food Log-2026-10-18-1', 'macrofactor-total-2026-10-17']);
    // Totals first, then the itemized food log replaces them.
    useStore.getState().importAll({});
    useStore.getState().importExternal(pack([{ id: 'macrofactor-total-2026-10-18', date: '2026-10-18' }]), { profile: false, goals: false });
    useStore.getState().importExternal(pack([{ id: 'macrofactor-Food Log-2026-10-18-1', date: '2026-10-18' }]), { profile: false, goals: false });
    expect(useStore.getState().log.map((e) => e.id)).toEqual(['macrofactor-Food Log-2026-10-18-1']);
  });
});
