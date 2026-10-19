import { describe, expect, it } from 'vitest';
import { importMacroFactor, isMacroFactorWorkbook } from './importMacroFactor';
import type { Cell } from './importMf';

/**
 * Checks a real MacroFactor export on the developer's machine. Skipped unless MF_EXPORT points
 * at an .xlsx file, so no personal data is needed in the repository.
 */
const file = process.env.MF_EXPORT;

describe.skipIf(!file)('real MacroFactor export', () => {
  it('imports every nutrition, body, library and goal sheet', async () => {
    const { default: readXlsxFile } = await import('read-excel-file/node');
    const sheets = (await readXlsxFile(file!)).map((s) => ({ name: s.sheet, rows: s.data as unknown as Cell[][] }));
    expect(isMacroFactorWorkbook(sheets)).toBe(true);
    const r = importMacroFactor(sheets, 'kg');
    console.log(JSON.stringify(r.summary));
    const sample = r.log.find((e) => (e.n.fiber ?? 0) > 0);
    console.log('total with micros:', JSON.stringify(sample?.n).slice(0, 300));
    console.log('first/last day:', r.log[0]?.date, r.log.at(-1)?.date);
    console.log('goals:', JSON.stringify(r.goals.map((g) => [g.type, g.startDate, g.endedAt ?? 'active', g.goalWeight, g.checkInDay])));
    console.log('active:', r.activeGoalId, 'latest targets:', JSON.stringify(r.snapshots.at(-1)));
    console.log('foods:', JSON.stringify(r.foods.map((f) => [f.id.slice(11, 45), f.servings[0].label, f.servings[0].grams, Math.round(f.per100.kcal ?? 0)])));
    console.log('measurements:', JSON.stringify(r.body.filter((b) => b.measurements || b.bodyFat).slice(0, 3)));
    console.log('profile:', JSON.stringify({ ...r.profile, birthYear: r.profile?.birthYear ? 'set' : undefined }), JSON.stringify(r.settings));
    expect(r.log.length).toBeGreaterThan(0);
  });
});
