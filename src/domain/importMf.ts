import { KJ_PER_KCAL } from './nutrition';
import type { BodyEntry, LogEntry, NutrientKey, Nutrients, WeightUnit } from './types';
import { LB_PER_KG } from './expenditure';

/**
 * Importer for spreadsheet exports from other nutrition apps (MacroFactor's Excel/CSV exports in
 * particular). Columns are matched by header text, so it tolerates column order, extra columns and
 * unit suffixes like "(kg)", "(lbs)", "(kcal)", "(kJ)", "(g)" and "(mg)".
 */

export type Cell = string | number | boolean | Date | null | undefined;
export interface SheetRows {
  name: string;
  rows: Cell[][];
}

export interface ImportResult {
  log: LogEntry[];
  body: BodyEntry[];
  summary: { foods: number; dailyTotals: number; weights: number; bodyFat: number; steps: number; days: number; sheets: string[]; skipped: number };
  warnings: string[];
}

type Field =
  | 'date'
  | 'time'
  | 'food'
  | 'servingLabel'
  | 'servingQty'
  | 'servingGrams'
  | 'unitGrams'
  | 'weight'
  | 'trend'
  | 'bodyFat'
  | 'steps'
  | 'expenditure'
  | NutrientKey;

interface Column {
  index: number;
  field: Field;
  unit?: string;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Header text (without the unit suffix) → field. Order matters: more specific first. */
const HEADER_RULES: [RegExp, Field][] = [
  [/^(date|day)$/, 'date'],
  [/^(time|time of day|hour)$/, 'time'],
  [/^(food name|food|name|item|description|food description)$/, 'food'],
  [/^(serving size|serving|serving name|serving description|unit)$/, 'servingLabel'],
  [/^(serving qty|serving quantity|quantity|qty|amount|servings)$/, 'servingQty'],
  // MacroFactor's Serving Weight is the weight of one unit; the others are the total eaten.
  [/^(serving weight|unit weight)$/, 'unitGrams'],
  [/^(weight eaten|grams|weight g|amount g|total weight)$/, 'servingGrams'],
  [/^(trend weight|weight trend|trend)$/, 'trend'],
  [/^(weight|scale weight|body weight|bodyweight)$/, 'weight'],
  [/^(body fat|body fat percentage|bodyfat|body fat %|fat %|fat percent|body fat percent)$/, 'bodyFat'],
  [/^(steps|step count|daily steps)$/, 'steps'],
  [/^(expenditure|tdee|energy expenditure|total expenditure)$/, 'expenditure'],
  [/^(calories|energy|kcal|kilocalories|calories consumed|energy consumed)$/, 'kcal'],
  [/^(protein|proteins)$/, 'protein'],
  [/^(fat|total fat|fats)$/, 'fat'],
  [/^(carbs|carbohydrates|total carbs|total carbohydrates|carbohydrate)$/, 'carbs'],
  [/^(fiber|fibre|dietary fiber|dietary fibre)$/, 'fiber'],
  [/^(sugar|sugars|total sugars)$/, 'sugar'],
  [/^(added sugar|added sugars|sugars added)$/, 'addedSugar'],
  [/^(saturated fat|saturated|sat fat)$/, 'satFat'],
  [/^(monounsaturated fat|monounsaturated)$/, 'monoFat'],
  [/^(polyunsaturated fat|polyunsaturated)$/, 'polyFat'],
  [/^(trans fat|trans)$/, 'transFat'],
  [/^cholesterol$/, 'cholesterol'],
  [/^(sodium|salt sodium)$/, 'sodium'],
  [/^potassium$/, 'potassium'],
  [/^calcium$/, 'calcium'],
  [/^iron$/, 'iron'],
  [/^magnesium$/, 'magnesium'],
  [/^zinc$/, 'zinc'],
  [/^phosphorus$/, 'phosphorus'],
  [/^selenium$/, 'selenium'],
  [/^vitamin a$/, 'vitaminA'],
  [/^vitamin c$/, 'vitaminC'],
  [/^vitamin d$/, 'vitaminD'],
  [/^vitamin e$/, 'vitaminE'],
  [/^vitamin k$/, 'vitaminK'],
  // MacroFactor writes B vitamins as "B2, Riboflavin" (commas are dropped before matching).
  [/^(thiamin|thiamine|vitamin b1|b1 thiamin|b1 thiamine)$/, 'thiamin'],
  [/^(riboflavin|vitamin b2|b2 riboflavin)$/, 'riboflavin'],
  [/^(niacin|vitamin b3|b3 niacin)$/, 'niacin'],
  [/^(vitamin b6|b6 pyridoxine|b6)$/, 'vitaminB6'],
  [/^(folate|folic acid|vitamin b9|b9 folate)$/, 'folate'],
  [/^(vitamin b12|b12 cobalamin|b12)$/, 'vitaminB12'],
  [/^caffeine$/, 'caffeine'],
  [/^alcohol$/, 'alcohol'],
];

/** Split "Weight (kg)" / "Sodium [mg]" / "Calories, kcal" into a name and a unit. */
export function parseHeader(raw: string): { name: string; unit?: string } {
  const s = norm(String(raw));
  const m = s.match(/^(.*?)\s*[([]\s*([^)\]]+?)\s*[)\]]\s*$/) ?? s.match(/^(.*?),\s*([a-zµμ%]+)$/);
  return m ? { name: m[1].trim(), unit: m[2].trim() } : { name: s };
}

/** Field for a header name without its unit; commas are ignored ("B12, Cobalamin"). */
function fieldFor(name: string): Field | undefined {
  const n = name.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return HEADER_RULES.find(([re]) => re.test(n))?.[1];
}

/** Nutrient key for a header such as "Fiber (g)" or "B12, Cobalamin (mcg)", with its unit. */
export function nutrientColumn(raw: string): { key: NutrientKey; unit?: string } | undefined {
  const { name, unit } = parseHeader(raw);
  const key = nutrientField(name);
  return key ? { key, unit } : undefined;
}

/** Nutrient key for a bare name without a unit suffix, such as "B12, Cobalamin". */
export function nutrientField(name: string): NutrientKey | undefined {
  const f = fieldFor(name.toLowerCase().replace(/[_\-.]+/g, ' '));
  return f && !NON_NUTRIENT.includes(f) ? (f as NutrientKey) : undefined;
}

const NON_NUTRIENT: Field[] = ['date', 'time', 'food', 'servingLabel', 'servingQty', 'servingGrams', 'unitGrams', 'weight', 'trend', 'bodyFat', 'steps', 'expenditure'];

function mapHeaders(row: Cell[]): Column[] {
  const cols: Column[] = [];
  const used = new Set<Field>();
  row.forEach((c, index) => {
    if (typeof c !== 'string' || !c.trim()) return;
    const { name, unit } = parseHeader(c);
    const nm = name.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    for (const [re, field] of HEADER_RULES) {
      if (re.test(nm) && !used.has(field)) {
        cols.push({ index, field, unit });
        used.add(field);
        break;
      }
    }
  });
  return cols;
}

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Parse dates from Date cells, ISO strings, Excel serials, or d/m/y vs m/d/y strings (dmy decides). */
export function parseDate(c: Cell, dmy: boolean): string | undefined {
  if (c instanceof Date && !Number.isNaN(c.getTime())) {
    // Spreadsheet readers return date-only cells as UTC midnight; reading local fields would
    // shift them to the previous day west of Greenwich.
    if (c.getUTCHours() === 0 && c.getUTCMinutes() === 0 && c.getUTCSeconds() === 0) {
      return `${c.getUTCFullYear()}-${String(c.getUTCMonth() + 1).padStart(2, '0')}-${String(c.getUTCDate()).padStart(2, '0')}`;
    }
    return isoOf(c);
  }
  if (typeof c === 'number' && c > 20000 && c < 80000) {
    // Excel serial date (1900 system).
    const d = new Date(Math.round((c - 25569) * 86400000));
    return isoOf(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  if (typeof c !== 'string') return undefined;
  const s = c.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const [day, month] = dmy ? [a, b] : [b, a];
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : isoOf(new Date(t));
}

/** Minutes after midnight from "8:30 AM", "20:15", a Date, or an Excel day fraction. */
export function parseTime(c: Cell): number | undefined {
  // Spreadsheet readers build time cells in UTC (on 1899-12-30); local fields would shift them.
  if (c instanceof Date) return c.getUTCHours() * 60 + c.getUTCMinutes();
  if (typeof c === 'number' && c >= 0 && c < 1) return Math.round(c * 1440);
  if (typeof c !== 'string') return undefined;
  const m = c.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (!m) return undefined;
  let h = Number(m[1]) % 24;
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h * 60 + Number(m[2]);
}

export const num = (c: Cell): number | undefined => {
  if (typeof c === 'number') return Number.isFinite(c) ? c : undefined;
  if (typeof c !== 'string') return undefined;
  const s = c.trim().replace(/\s/g, '');
  if (!s) return undefined;
  // "1.234,5" (European) vs "1,234.5"
  const v = /,\d{1,2}$/.test(s) && !s.includes('.') ? Number(s.replace(',', '.')) : Number(s.replace(/,/g, ''));
  return Number.isFinite(v) ? v : undefined;
};

/** Convert a nutrient value to Satiago's unit for that nutrient. */
export function toUnit(field: NutrientKey, v: number, unit?: string): number {
  const u = unit?.toLowerCase();
  if (field === 'kcal') return u === 'kj' ? v / KJ_PER_KCAL : v;
  const mgFields: NutrientKey[] = ['cholesterol', 'sodium', 'potassium', 'calcium', 'iron', 'magnesium', 'zinc', 'phosphorus', 'vitaminC', 'vitaminE', 'thiamin', 'riboflavin', 'niacin', 'vitaminB6', 'caffeine'];
  const mcgFields: NutrientKey[] = ['selenium', 'vitaminA', 'vitaminD', 'vitaminK', 'folate', 'vitaminB12'];
  const factor: Record<string, number> = { g: 1, mg: 0.001, mcg: 1e-6, µg: 1e-6, μg: 1e-6, ug: 1e-6 };
  if (!u || !(u in factor)) return v;
  const target = mgFields.includes(field) ? 0.001 : mcgFields.includes(field) ? 1e-6 : 1;
  return (v * factor[u]) / target;
}

export function weightTo(v: number, unit: string | undefined, target: WeightUnit): number {
  const u = unit?.toLowerCase().replace('.', '');
  const kg = u === 'lb' || u === 'lbs' || u === 'pounds' ? v / LB_PER_KG : v;
  return Math.round((target === 'kg' ? kg : kg * LB_PER_KG) * 10) / 10;
}

/** Find the header row: the first row (within 15) that maps a date plus at least one data column. */
function findHeader(rows: Cell[][]): { at: number; cols: Column[] } | undefined {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cols = mapHeaders(rows[i] ?? []);
    if (cols.some((c) => c.field === 'date') && cols.length >= 2) return { at: i, cols };
  }
  return undefined;
}

/** Decide whether ambiguous slash dates are day-first by scanning for a first part above 12. */
function detectDmy(rows: Cell[][], dateIdx: number): boolean {
  let dmy = false;
  let mdy = false;
  for (const r of rows) {
    const c = r[dateIdx];
    if (typeof c !== 'string') continue;
    const m = c.trim().match(/^(\d{1,2})[/.](\d{1,2})[/.]/);
    if (!m) continue;
    if (Number(m[1]) > 12) dmy = true;
    if (Number(m[2]) > 12) mdy = true;
  }
  return dmy && !mdy;
}

/**
 * Convert spreadsheet sheets into Satiago entries. Itemized food rows become log entries; rows
 * with calories but no food name become one "daily total" entry per day (only for days without
 * itemized foods). Weight, body fat and steps become body entries. Expenditure and trend columns
 * are read but not imported: Satiago recomputes them from the imported intake and weights.
 * Entry ids are deterministic, so importing the same file twice does not duplicate data.
 */
export function importSheets(sheets: SheetRows[], weightUnit: WeightUnit, source = 'Imported'): ImportResult {
  const log: LogEntry[] = [];
  const totals = new Map<string, Nutrients>();
  const body = new Map<string, BodyEntry>();
  const itemizedDays = new Set<string>();
  const warnings: string[] = [];
  const used: string[] = [];
  let skipped = 0;
  const slug = source.toLowerCase().replace(/[^a-z0-9]+/g, '');

  for (const sheet of sheets) {
    const head = findHeader(sheet.rows);
    if (!head) continue;
    used.push(sheet.name);
    const col = (f: Field) => head.cols.find((c) => c.field === f);
    const dateCol = col('date')!;
    const dataRows = sheet.rows.slice(head.at + 1);
    const dmy = detectDmy(dataRows, dateCol.index);
    const nutrientCols = head.cols.filter((c) => !NON_NUTRIENT.includes(c.field));

    dataRows.forEach((r, i) => {
      if (!r || r.every((c) => c === null || c === undefined || c === '')) return;
      const date = parseDate(r[dateCol.index], dmy);
      if (!date) {
        skipped++;
        return;
      }
      const n: Nutrients = {};
      for (const c of nutrientCols) {
        const v = num(r[c.index]);
        if (v !== undefined && v >= 0) n[c.field as NutrientKey] = Math.round(toUnit(c.field as NutrientKey, v, c.unit) * 1000) / 1000;
      }
      const foodCol = col('food');
      const food = foodCol ? r[foodCol.index] : undefined;
      if (typeof food === 'string' && food.trim() && n.kcal !== undefined) {
        const t = col('time') ? parseTime(r[col('time')!.index]) : undefined;
        const qty = col('servingQty') ? num(r[col('servingQty')!.index]) : undefined;
        const label = col('servingLabel') ? r[col('servingLabel')!.index] : undefined;
        const unitGrams = col('unitGrams') ? num(r[col('unitGrams')!.index]) : undefined;
        const grams = col('servingGrams') ? num(r[col('servingGrams')!.index]) : unitGrams !== undefined ? Math.round(unitGrams * (qty ?? 1) * 100) / 100 : undefined;
        log.push({
          id: `${slug}-${sheet.name}-${date}-${head.at + 1 + i}`.replace(/\s+/g, '_'),
          date,
          minute: t ?? 12 * 60,
          name: food.trim(),
          icon: '📥',
          grams,
          qty,
          servingLabel: typeof label === 'string' && label.trim() ? label.trim() : undefined,
          n,
        });
        itemizedDays.add(date);
      } else if (!foodCol && n.kcal !== undefined && n.kcal > 0) {
        totals.set(date, n);
      }

      const b: BodyEntry = body.get(date) ?? { date };
      const w = col('weight') ? num(r[col('weight')!.index]) : undefined;
      if (w !== undefined && w > 0) b.weight = weightTo(w, col('weight')!.unit, weightUnit);
      const bf = col('bodyFat') ? num(r[col('bodyFat')!.index]) : undefined;
      if (bf !== undefined && bf > 0) b.bodyFat = bf <= 1 ? Math.round(bf * 1000) / 10 : bf;
      const steps = col('steps') ? num(r[col('steps')!.index]) : undefined;
      if (steps !== undefined && steps > 0) b.steps = Math.round(steps);
      if (b.weight !== undefined || b.bodyFat !== undefined || b.steps !== undefined) body.set(date, b);
    });
  }

  for (const [date, n] of totals) {
    if (itemizedDays.has(date)) continue;
    log.push({ id: `${slug}-total-${date}`, date, minute: 12 * 60, name: `${source} daily total`, icon: '📥', n });
  }

  if (!used.length) warnings.push('No sheet with a Date column and nutrition or weight columns was found.');
  const bodyList = [...body.values()].sort((a, b) => a.date.localeCompare(b.date));
  const days = new Set([...log.map((e) => e.date), ...bodyList.map((b) => b.date)]);
  return {
    log,
    body: bodyList,
    summary: {
      foods: log.filter((e) => !e.id.includes('-total-')).length,
      dailyTotals: log.filter((e) => e.id.includes('-total-')).length,
      weights: bodyList.filter((b) => b.weight !== undefined).length,
      bodyFat: bodyList.filter((b) => b.bodyFat !== undefined).length,
      steps: bodyList.filter((b) => b.steps !== undefined).length,
      days: days.size,
      sheets: used,
      skipped,
    },
    warnings,
  };
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF), auto-detecting , ; or tab. */
export function parseCsv(text: string): Cell[][] {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
  const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** Merge rule shared with Health Connect sync: existing values for a date and field win. */
export function mergeBody(existing: BodyEntry[], incoming: BodyEntry[]): BodyEntry[] {
  const by = new Map(existing.map((b) => [b.date, { ...b }]));
  for (const b of incoming) {
    const cur = by.get(b.date) ?? { date: b.date };
    if (cur.weight === undefined && b.weight !== undefined) cur.weight = b.weight;
    if (cur.bodyFat === undefined && b.bodyFat !== undefined) cur.bodyFat = b.bodyFat;
    if (cur.steps === undefined && b.steps !== undefined) cur.steps = b.steps;
    if (b.measurements) {
      const m = { ...cur.measurements };
      for (const [k, v] of Object.entries(b.measurements) as [keyof typeof m, number | undefined][]) if (m[k] === undefined && v !== undefined) m[k] = v;
      cur.measurements = m;
    }
    if (b.period && !cur.period) cur.period = true;
    by.set(b.date, cur);
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}
