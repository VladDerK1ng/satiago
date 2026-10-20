import { it } from 'vitest';
import { unusualWeights } from './body';
import { intakeDays } from './coach';
import { energyDensity, expenditureSeries, initialExpenditure, type ExpenditureOptions } from './expenditure';
import { importMacroFactor } from './importMacroFactor';
import type { Cell } from './importMf';
import { dailyTrend, dayIndex } from './trend';
import type { Profile } from './types';

// Local only: compares Satiago's expenditure with MacroFactor's own numbers from a real export,
// and scores every variant on how well it predicts the next 14 / 28 days of weight change.
//   MF_EXPORT=path/to/MacroFactor-….xlsx npx vitest run src/domain/calibrate.local.test.ts
it.skipIf(!process.env.MF_EXPORT)('calibrate expenditure against MacroFactor', { timeout: 600_000 }, async () => {
  const { default: readXlsxFile } = await import('read-excel-file/node');
  const sheets = (await readXlsxFile(process.env.MF_EXPORT!)).map((s) => ({ name: s.sheet, rows: s.data as unknown as Cell[][] }));
  const r = importMacroFactor(sheets, 'kg');
  const odd = new Set(unusualWeights(r.body).map((u) => u.date));
  const body = r.body.map((b) => (odd.has(b.date) ? { ...b, weight: undefined } : b));
  const profile: Profile = { sex: 'male', birthYear: 2000, heightCm: 175, activity: 'moderate', athlete: false, ...r.profile };
  const mf = new Map((r.expenditure ?? []).map((e) => [e.date, e.kcal]));
  const dates = [...mf.keys()].sort();
  // Start where MacroFactor started, so only the algorithms differ.
  const intake = intakeDays(r.log, r.meta).filter((d) => d.date >= dates[0]);
  const trend = dailyTrend(body, 0.1, dates.at(-1));
  const init = mf.get(dates[0]) ?? initialExpenditure(profile, trend[0]?.trend ?? 70);
  const forbes = (kg: number) => energyDensity(profile, kg);
  const burnIn = dates.slice(28);

  const weightOn = new Map(body.filter((b) => b.weight !== undefined).map((b) => [dayIndex(b.date), b.weight!]));
  const kcalOn = new Map(intake.filter((d) => d.kcal && !d.partial).map((d) => [dayIndex(d.date), d.kcal!]));
  const level = (d: number) => {
    const v: number[] = [];
    for (let j = d - 3; j <= d + 3; j++) if (weightOn.has(j)) v.push(weightOn.get(j)!);
    return v.length >= 3 ? v.sort((a, b) => a - b)[Math.floor(v.length / 2)] : undefined;
  };
  // Forecast error (kg): predicted weight change over H days from logged intake and the estimate on day d.
  const forecast = (est: Map<string, number>, H: number) => {
    let err = 0;
    let n = 0;
    for (const date of burnIn) {
      const d = dayIndex(date);
      const a = level(d);
      const b = level(d + H);
      const e = est.get(date);
      if (a === undefined || b === undefined || e === undefined) continue;
      let s = 0;
      let logged = 0;
      for (let i = d; i < d + H; i++) if (kcalOn.has(i)) { s += kcalOn.get(i)!; logged++; }
      if (logged < 0.8 * H) continue;
      err += Math.abs(((s / logged - e) * H) / forbes(a) - (b - a));
      n++;
    }
    return Math.round((err / n) * 1000) / 1000;
  };
  const report = (name: string, est: Map<string, number>) => {
    let abs = 0;
    let bias = 0;
    let jitter = 0;
    let n = 0;
    let prev: number | undefined;
    for (const d of burnIn) {
      const a = est.get(d);
      const b = mf.get(d);
      if (a === undefined || b === undefined) continue;
      abs += Math.abs(a - b);
      bias += a - b;
      if (prev !== undefined) jitter += Math.abs(a - prev);
      prev = a;
      n++;
    }
    console.log(name.padEnd(28), 'vs MF MAE', Math.round(abs / n), 'bias', Math.round(bias / n), '| forecast 14d', forecast(est, 14), '28d', forecast(est, 28), '| jitter', Math.round((jitter / n) * 10) / 10);
  };
  const run = (o: ExpenditureOptions) => new Map(expenditureSeries(intake, trend, init, dates.at(-1)!, { energyDensity: forbes, ...o }).map((p) => [p.date, p.expenditure]));

  report('MacroFactor', mf);
  report('Satiago (default ensemble)', run({}));
  report('regression part only', run({ stateWeight: 0 }));
  report('state-space part only', run({ stateWeight: 1 }));
  report('no glycogen correction', run({ glycogenKg: 0 }));
  report('constant 7700 kcal/kg', run({ energyDensity: 7700 }));
});
