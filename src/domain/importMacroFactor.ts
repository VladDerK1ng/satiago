import { nutrientColumn, nutrientField, num, parseDate, parseHeader, toUnit, weightTo, type Cell, type ImportResult, type SheetRows } from './importMf';
import { MEASUREMENT_KEYS, type ActivityLevel, type BodyEntry, type DayMeta, type Food, type Goal, type GoalType, type LogEntry, type MacroTarget, type MeasurementKey, type NutrientKey, type Nutrients, type Profile, type Settings, type TargetSnapshot, type WeightUnit } from './types';

/**
 * Importer for MacroFactor's full Excel export (Settings → Data export). The workbook has one
 * sheet per data type; this reads the nutrition, body, food library, profile and goal sheets and
 * ignores the workout sheets. Ids are deterministic ("macrofactor-…"), so importing the same or a
 * newer export again updates instead of duplicating.
 */

export interface ExternalImport {
  log: LogEntry[];
  body: BodyEntry[];
  meta: DayMeta[];
  foods: Food[];
  favorites: string[];
  goals: Goal[];
  snapshots: TargetSnapshot[];
  activeGoalId?: string;
  /** Daily expenditure from the other app, which Satiago continues from. */
  expenditure?: { date: string; kcal: number }[];
  profile?: Partial<Profile>;
  settings?: Partial<Pick<Settings, 'microGoals' | 'projection'>>;
  summary: {
    days: number;
    dailyTotals: number;
    expenditure: number;
    foodEntries: number;
    weights: number;
    bodyFat: number;
    steps: number;
    measurements: number;
    flags: number;
    notes: number;
    foods: number;
    recipes: number;
    goals: number;
    targets: number;
    skipped: number;
    ignored: string[];
  };
  warnings: string[];
}

const PREFIX = 'macrofactor';
/** Sheets that identify a MacroFactor export. */
const MARKERS = ['calories & macros', 'micronutrients', 'scale weight', 'weight trend', 'nutrition program settings'];
/** Sheets read elsewhere or deliberately skipped (Satiago recomputes trend and expenditure). */
const IGNORED = /^(weight trend|muscle groups|exercises|training programs|workouts|workout|gym profiles|custom exercises|exercise settings|history)/i;

/** Wraps the generic spreadsheet importer's result (CSV or other apps) in the same shape. */
export function fromGeneric(r: ImportResult): ExternalImport {
  return {
    log: r.log,
    body: r.body,
    meta: [],
    foods: [],
    favorites: [],
    goals: [],
    snapshots: [],
    summary: {
      days: r.summary.days,
      dailyTotals: r.summary.dailyTotals,
      expenditure: 0,
      foodEntries: r.summary.foods,
      weights: r.summary.weights,
      bodyFat: r.summary.bodyFat,
      steps: r.summary.steps,
      measurements: 0,
      flags: 0,
      notes: 0,
      foods: 0,
      recipes: 0,
      goals: 0,
      targets: 0,
      skipped: r.summary.skipped,
      ignored: [],
    },
    warnings: r.warnings,
  };
}

export const isMacroFactorWorkbook = (sheets: SheetRows[]) => sheets.filter((s) => MARKERS.includes(s.name.trim().toLowerCase())).length >= 2;

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const MEASURE_NAMES: Record<string, MeasurementKey> = Object.fromEntries(
  MEASUREMENT_KEYS.map((k) => [k.replace(/([A-Z])/g, ' $1').toLowerCase(), k]),
) as Record<string, MeasurementKey>;

/** Readable id part from a name; letters of any script are kept, accents dropped. */
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'item';

const str = (c: Cell) => (typeof c === 'string' ? c.trim() : typeof c === 'number' || typeof c === 'boolean' ? String(c) : '');
const yes = (c: Cell) => /^(yes|true|1|da|ja|oui|sí|si)$/i.test(str(c));

interface Table {
  header: string[];
  rows: Cell[][];
  col: (re: RegExp) => number;
}

function table(sheet: SheetRows | undefined): Table | undefined {
  if (!sheet?.rows.length) return undefined;
  const header = (sheet.rows[0] ?? []).map((c) => str(c));
  const rows = sheet.rows.slice(1).filter((r) => r && r.some((c) => c !== null && c !== undefined && c !== ''));
  return { header, rows, col: (re) => header.findIndex((h) => re.test(h)) };
}

/** Day-first unless a slash date anywhere in the workbook proves month-first. */
function detectDmy(sheets: SheetRows[]): boolean {
  let dmy = false;
  let mdy = false;
  for (const s of sheets)
    for (const r of s.rows)
      for (const c of r ?? []) {
        if (typeof c !== 'string') continue;
        const m = c.trim().match(/^(\d{1,2})[/.](\d{1,2})[/.]\d{2,4}$/);
        if (!m) continue;
        if (Number(m[1]) > 12) dmy = true;
        if (Number(m[2]) > 12) mdy = true;
      }
  return dmy || !mdy;
}

/** Nutrient columns of a header row: index, Satiago key and the column's unit. */
function nutrientCols(header: string[]) {
  const out: { index: number; key: NutrientKey; unit?: string }[] = [];
  const seen = new Set<NutrientKey>();
  header.forEach((h, index) => {
    const c = h ? nutrientColumn(h) : undefined;
    if (c && !seen.has(c.key)) {
      seen.add(c.key);
      out.push({ index, ...c });
    }
  });
  return out;
}

function readNutrients(r: Cell[], cols: ReturnType<typeof nutrientCols>, into: Nutrients = {}): Nutrients {
  for (const c of cols) {
    const v = num(r[c.index]);
    if (v !== undefined && v >= 0) into[c.key] = Math.round(toUnit(c.key, v, c.unit) * 1000) / 1000;
  }
  return into;
}

const scaleNutrients = (n: Nutrients, f: number): Nutrients =>
  Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Math.round((v ?? 0) * f * 1000) / 1000])) as Nutrients;

const goalType = (s: string): GoalType => (/loss|lose|cut/i.test(s) ? 'lose' : /gain|bulk/i.test(s) ? 'gain' : 'maintain');

const activity = (s: string): ActivityLevel | undefined =>
  /very|extra/i.test(s) ? 'very' : /moderate/i.test(s) ? 'moderate' : /light/i.test(s) ? 'light' : /sedentary|none|relaxed/i.test(s) ? 'sedentary' : undefined;

/** Weekday of an ISO date, Monday = 0. */
const weekday = (iso: string) => (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;

export interface MacroFactorOptions {
  /** Dates that already have food logged in Satiago: their MacroFactor daily totals are skipped. */
  skipTotalsOn?: Set<string>;
}

export function importMacroFactor(sheets: SheetRows[], weightUnit: WeightUnit, opts: MacroFactorOptions = {}): ExternalImport {
  const byName = new Map(sheets.map((s) => [s.name.trim().toLowerCase(), s]));
  const sheet = (name: string) => byName.get(name);
  const dmy = detectDmy(sheets);
  const date = (c: Cell) => parseDate(c, dmy);
  const warnings: string[] = [];
  let skipped = 0;

  // --- Daily nutrition: two sheets with the same dates, merged into one total per day.
  const totals = new Map<string, Nutrients>();
  for (const name of ['calories & macros', 'micronutrients']) {
    const tb = table(sheet(name));
    if (!tb) continue;
    const di = tb.col(/^date$/i);
    const cols = nutrientCols(tb.header);
    for (const r of tb.rows) {
      const d = date(r[di]);
      if (!d) {
        skipped++;
        continue;
      }
      totals.set(d, readNutrients(r, cols, totals.get(d) ?? {}));
    }
  }

  // --- Expenditure: MacroFactor's own estimate, continued by Satiago afterwards.
  const expenditure: { date: string; kcal: number }[] = [];
  const et = table(sheet('expenditure'));
  if (et) {
    const di = et.col(/^date$/i);
    const ei = et.col(/^expenditure/i);
    for (const r of et.rows) {
      const d = date(r[di]);
      const v = ei >= 0 ? num(r[ei]) : undefined;
      if (d && v !== undefined && v > 500) expenditure.push({ date: d, kcal: Math.round(v) });
    }
  }

  // --- Day flags and notes.
  const meta = new Map<string, DayMeta>();
  const flag = (name: string, re: RegExp, set: (m: DayMeta, r: Cell[], i: number) => void) => {
    const tb = table(sheet(name));
    if (!tb) return;
    const di = tb.col(/^date$/i);
    const vi = tb.col(re);
    if (di < 0 || vi < 0) return;
    for (const r of tb.rows) {
      const d = date(r[di]);
      if (!d) continue;
      const m = meta.get(d) ?? { date: d };
      set(m, r, vi);
      if (m.fasted || m.partial || m.note) meta.set(d, m);
    }
  };
  flag('fasting', /^fasting$/i, (m, r, i) => yes(r[i]) && (m.fasted = true));
  flag('partial logging', /^partial/i, (m, r, i) => yes(r[i]) && (m.partial = true));
  flag('food log notes', /notes$/i, (m, r, i) => {
    const note = str(r[i]);
    if (note) m.note = m.note ? `${m.note}\n${note}` : note;
  });

  const log: LogEntry[] = [];
  for (const [d, n] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
    const any = Object.values(n).some((v) => (v ?? 0) > 0);
    // Empty days stay empty unless MacroFactor marked them as a fast.
    if (!any || opts.skipTotalsOn?.has(d)) continue;
    log.push({ id: `${PREFIX}-total-${d}`, date: d, minute: 12 * 60, name: 'MacroFactor daily total', icon: '📥', n });
  }

  // --- Body: scale weight and body fat, tape measurements, steps.
  const body = new Map<string, BodyEntry>();
  const bodyAt = (d: string) => body.get(d) ?? body.set(d, { date: d }).get(d)!;
  const weights = table(sheet('scale weight'));
  if (weights) {
    const di = weights.col(/^date$/i);
    const wi = weights.col(/^weight/i);
    const fi = weights.col(/fat/i);
    const unit = wi >= 0 ? parseHeader(weights.header[wi]).unit : undefined;
    for (const r of weights.rows) {
      const d = date(r[di]);
      if (!d) continue;
      const w = wi >= 0 ? num(r[wi]) : undefined;
      if (w !== undefined && w > 0) bodyAt(d).weight = weightTo(w, unit, weightUnit);
      const bf = fi >= 0 ? num(r[fi]) : undefined;
      if (bf !== undefined && bf > 0) bodyAt(d).bodyFat = bf <= 1 ? Math.round(bf * 1000) / 10 : bf;
    }
  }
  const metrics = table(sheet('body metrics'));
  if (metrics) {
    const di = metrics.col(/^date$/i);
    const visual = metrics.col(/visual body fat/i);
    const sites = metrics.header
      .map((h, index) => {
        const { name, unit } = parseHeader(h);
        const key = MEASURE_NAMES[name];
        return key ? { index, key, unit } : undefined;
      })
      .filter((x): x is { index: number; key: MeasurementKey; unit: string | undefined } => !!x);
    for (const r of metrics.rows) {
      const d = date(r[di]);
      if (!d) continue;
      for (const s of sites) {
        const v = num(r[s.index]);
        if (v === undefined || v <= 0) continue;
        const b = bodyAt(d);
        b.measurements = { ...b.measurements, [s.key]: Math.round((s.unit === 'in' ? v * 2.54 : v) * 10) / 10 };
      }
      const vb = visual >= 0 ? num(r[visual]) : undefined;
      if (vb !== undefined && vb > 0 && bodyAt(d).bodyFat === undefined) bodyAt(d).bodyFat = vb;
    }
  }
  const steps = table(sheet('steps'));
  if (steps) {
    const di = steps.col(/^date$/i);
    const si = steps.col(/^steps/i);
    for (const r of steps.rows) {
      const d = date(r[di]);
      const v = si >= 0 ? num(r[si]) : undefined;
      if (d && v !== undefined && v > 0) bodyAt(d).steps = Math.round(v);
    }
  }
  for (const [d, b] of body) if (Object.keys(b).length === 1) body.delete(d);

  // --- Food library: custom foods, favorites and recipes.
  const foods = new Map<string, Food>();
  const favorites: string[] = [];
  // Same name twice (or names that slug alike) get -2, -3… in sheet order, which is stable between exports.
  const seen = new Map<string, string>();
  const idFor = (base: string) => {
    let id = base;
    for (let i = 2; foods.has(id); i++) id = `${base}-${i}`;
    return id;
  };
  const rt = table(sheet('recipes'));
  // MacroFactor also lists recipes among custom foods; the Recipes sheet has the better data.
  const recipeNames = new Set((rt?.rows ?? []).map((r) => str(r[rt!.col(/^recipe name$/i)]).toLowerCase()));
  for (const name of ['custom foods', 'favorites']) {
    const tb = table(sheet(name));
    if (!tb) continue;
    const ni = tb.col(/^food name$/i);
    const sizeI = tb.col(/^serving size$/i);
    const qtyI = tb.col(/^serving qty$/i);
    const wI = tb.col(/^serving weight/i);
    const cols = nutrientCols(tb.header);
    for (const r of tb.rows) {
      const fname = str(r[ni]);
      const n = readNutrients(r, cols);
      if (!fname || n.kcal === undefined || recipeNames.has(fname.toLowerCase())) continue;
      const size = str(r[sizeI]) || 'serving';
      const qty = num(r[qtyI]) || 1;
      const unitGrams = num(r[wI]);
      const byWeight = /^(g|ml)$/i.test(size);
      // Weight units keep the logged amount as the serving ("40 g"); other units become "1 cup" etc.
      const grams = unitGrams && unitGrams > 0 ? (byWeight ? qty : 1) * unitGrams : undefined;
      const label = byWeight ? `${qty} ${size}` : `1 ${size}`;
      // Nutrients in the sheet are for the default quantity (Serving Qty x Serving Weight).
      const per100 = unitGrams && unitGrams > 0 ? scaleNutrients(n, 100 / (qty * unitGrams)) : scaleNutrients(n, 1 / qty);
      // A food listed in both Custom Foods and Favorites (or twice with another default amount) is one food.
      const same = `${fname.toLowerCase()}|${label}|${grams ?? ''}|${Math.round(per100.kcal ?? 0)}`;
      const known = seen.get(same);
      if (known) {
        if (name === 'favorites' && !favorites.includes(known)) favorites.push(known);
        continue;
      }
      const id = idFor(`${PREFIX}-food-${slug(fname)}`);
      seen.set(same, id);
      foods.set(id, {
        id,
        name: fname,
        icon: '🍽',
        category: 'Packaged',
        per100,
        servings: [{ label, grams: grams ?? 100 }],
        source: 'custom',
        liquid: /ml|fl oz|cup/i.test(size) || undefined,
        noWeight: grams ? undefined : true,
      });
      if (name === 'favorites') favorites.push(id);
    }
  }
  let recipes = 0;
  if (rt) {
    const ni = rt.col(/^recipe name$/i);
    const wI = rt.col(/^total weight/i);
    const sI = rt.col(/^serving qty$/i);
    const cols = nutrientCols(rt.header);
    for (const r of rt.rows) {
      const rname = str(r[ni]);
      const n = readNutrients(r, cols);
      if (!rname || n.kcal === undefined) continue;
      const servings = num(r[sI]) || 1;
      const total = num(r[wI]);
      const id = idFor(`${PREFIX}-recipe-${slug(rname)}`);
      // Nutrients are for the whole recipe. Without a total weight, one serving is priced as a nominal 100 g.
      const weight = total && total > 0 ? total : 100 * servings;
      foods.set(id, {
        id,
        name: rname,
        icon: '🍲',
        category: 'Prepared',
        per100: scaleNutrients(n, 100 / weight),
        servings: [{ label: '1 serving', grams: weight / servings }],
        source: 'custom',
        noWeight: total && total > 0 ? undefined : true,
      });
      recipes++;
    }
  }

  // --- Profile.
  let profile: Partial<Profile> | undefined;
  let projection: Settings['projection'] | undefined;
  const pt = table(sheet('user profile'));
  if (pt?.rows[0]) {
    const r = pt.rows[0];
    const p: Partial<Profile> = {};
    const sex = str(r[pt.col(/^sex$/i)]);
    if (/^m/i.test(sex)) p.sex = 'male';
    else if (/^f/i.test(sex)) p.sex = 'female';
    const born = date(r[pt.col(/^birthday$/i)]);
    if (born) p.birthYear = Number(born.slice(0, 4));
    const hi = pt.col(/^height/i);
    const h = hi >= 0 ? num(r[hi]) : undefined;
    if (h && h > 0) p.heightCm = Math.round(parseHeader(pt.header[hi]).unit === 'in' ? h * 2.54 : h);
    const act = activity(str(r[pt.col(/activity level/i)]));
    if (act) p.activity = act;
    if (Object.keys(p).length) profile = p;
    const pred = str(r[pt.col(/^prediction style$/i)]);
    projection = /blend/i.test(pred) ? 'blend' : /goal/i.test(pred) ? 'goal' : pred ? 'data' : undefined;
  }

  // --- Goals and the weekly targets MacroFactor set for them.
  const goals: Goal[] = [];
  let activeGoalId: string | undefined;
  const gt = table(sheet('weight goals'));
  const programs = table(sheet('nutrition program settings'));
  const updates = new Map<string, { expenditure?: number; days: (MacroTarget | undefined)[] }>();
  if (programs) {
    const di = programs.col(/update date/i);
    const wd = programs.col(/weekday/i);
    const kc = programs.col(/^calories/i);
    const pr = programs.col(/^protein/i);
    const ca = programs.col(/^carbs/i);
    const fa = programs.col(/^fat/i);
    const ex = programs.col(/^expenditure/i);
    for (const r of programs.rows) {
      const d = date(r[di]);
      const day = WEEKDAYS.indexOf(str(r[wd]).toLowerCase());
      const kcal = num(r[kc]);
      if (!d || day < 0 || !kcal) continue;
      const u = updates.get(d) ?? { days: [] };
      u.days[day] = { kcal, protein: num(r[pr]) ?? 0, carbs: num(r[ca]) ?? 0, fat: num(r[fa]) ?? 0 };
      u.expenditure = num(r[ex]) ?? u.expenditure;
      updates.set(d, u);
    }
  }
  const updateDates = [...updates.keys()].sort();
  if (gt) {
    gt.rows.sort((a, b) => (date(a[gt.col(/^start date$/i)]) ?? '').localeCompare(date(b[gt.col(/^start date$/i)]) ?? ''));
    const typeI = gt.col(/^goal$/i);
    const statusI = gt.col(/^status$/i);
    const startI = gt.col(/^start date$/i);
    const endI = gt.col(/^end date$/i);
    const goalWI = gt.col(/^goal weight/i);
    const rateI = gt.col(/rate per week/i);
    const startWI = gt.col(/^starting scale weight/i);
    const wUnit = goalWI >= 0 ? parseHeader(gt.header[goalWI]).unit : 'kg';
    for (const r of gt.rows) {
      const start = date(r[startI]);
      if (!start) continue;
      const end = date(r[endI]);
      const status = str(r[statusI]);
      const type = goalType(str(r[typeI]));
      const gw = num(r[goalWI]);
      const sw = num(r[startWI]);
      // Without a starting weight, use the first weigh-in from the start date on (else the last before it).
      const weighed = [...body.values()].filter((b) => b.weight !== undefined).sort((a, b) => a.date.localeCompare(b.date));
      const startWeight = sw ? weightTo(sw, wUnit, weightUnit) : (weighed.find((b) => b.date >= start) ?? weighed.at(-1))?.weight;
      if (!startWeight) continue;
      const inPeriod = updateDates.filter((d) => d >= start && (!end || d < end));
      const g: Goal = {
        id: `${PREFIX}-goal-${start}`,
        type,
        startDate: start,
        startWeight,
        goalWeight: type !== 'maintain' && gw ? weightTo(gw, wUnit, weightUnit) : undefined,
        ratePct: type === 'maintain' ? 0 : Math.abs(num(r[rateI]) ?? 0.5),
        style: 'coached',
        diet: 'balanced',
        protein: 'moderate',
        floor: 'standard',
        highDays: [],
        highShift: 0,
        // MacroFactor updates targets on the same weekday each week.
        checkInDay: inPeriod.length ? weekday(inPeriod[inPeriod.length - 1]) : weekday(start),
        endedAt: end && !/progress|active|current/i.test(status) ? end : undefined,
      };
      goals.push(g);
      if (!g.endedAt) activeGoalId = g.id;
    }
  }
  const snapshots: TargetSnapshot[] = [];
  for (const d of updateDates) {
    const u = updates.get(d)!;
    const filled = WEEKDAYS.map((_, i) => u.days[i] ?? u.days.find((x) => x));
    if (filled.some((x) => !x)) continue;
    // The goal running on that date; updates before any goal attach to the earliest one.
    const g = [...goals].reverse().find((x) => x.startDate <= d) ?? goals[0];
    if (!g) continue;
    snapshots.push({ date: d, goalId: g.id, expenditure: u.expenditure ?? filled[0]!.kcal, targets: filled as MacroTarget[], reason: 'Imported from MacroFactor.' });
  }

  // --- Micronutrient goals: "<Nutrient> Floor/Target/Ceiling" columns, latest row wins.
  let microGoals: Settings['microGoals'] | undefined;
  const mg = table(sheet('micronutrient goals'));
  const lastGoals = mg?.rows.at(-1);
  if (mg && lastGoals) {
    const out: Settings['microGoals'] = {};
    mg.header.forEach((h, i) => {
      const m = h.match(/^(.*)\s(floor|target|ceiling)$/i);
      const v = num(lastGoals[i]);
      if (!m || v === undefined) return;
      const key = nutrientField(m[1]);
      if (!key || key === 'kcal') return;
      const kind = m[2].toLowerCase() as 'floor' | 'target' | 'ceiling';
      out[key] = { ...out[key], [kind]: v };
    });
    if (Object.keys(out).length) microGoals = out;
  }

  const bodyList = [...body.values()].sort((a, b) => a.date.localeCompare(b.date));
  const metaList = [...meta.values()].sort((a, b) => a.date.localeCompare(b.date));
  const ignored = sheets.map((s) => s.name).filter((n) => IGNORED.test(n.trim()));
  if (!log.length && !bodyList.length && !foods.size) warnings.push('No nutrition, body or food data was found in this MacroFactor export.');
  const days = new Set([...log.map((e) => e.date), ...bodyList.map((b) => b.date)]);
  return {
    log,
    body: bodyList,
    meta: metaList,
    foods: [...foods.values()],
    favorites,
    goals,
    snapshots,
    activeGoalId,
    expenditure,
    profile,
    settings: microGoals || projection ? { ...(microGoals ? { microGoals } : {}), ...(projection ? { projection } : {}) } : undefined,
    summary: {
      days: days.size,
      dailyTotals: log.length,
      expenditure: expenditure.length,
      foodEntries: 0,
      weights: bodyList.filter((b) => b.weight !== undefined).length,
      bodyFat: bodyList.filter((b) => b.bodyFat !== undefined).length,
      steps: bodyList.filter((b) => b.steps !== undefined).length,
      measurements: bodyList.filter((b) => b.measurements).length,
      flags: metaList.filter((m) => m.fasted || m.partial).length,
      notes: metaList.filter((m) => m.note).length,
      foods: foods.size - recipes,
      recipes,
      goals: goals.length,
      targets: snapshots.length,
      skipped,
      ignored,
    },
    warnings,
  };
}
