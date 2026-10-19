import { Health } from '@capgo/capacitor-health';
import { fail, isNative, ok, type Result } from './native';

const READ = ['weight', 'bodyFat', 'steps'] as const;
const WRITE_BODY = ['weight', 'bodyFat'] as const;
const WRITE_NUTRITION = ['dietaryEnergyConsumed', 'dietaryWater'] as const;
type WriteType = (typeof WRITE_BODY)[number] | (typeof WRITE_NUTRITION)[number];

export async function healthAvailable(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const r = await Health.isAvailable();
    return !!r.available;
  } catch {
    return false;
  }
}

/** Request access. Nutrition and water write scopes are asked for only when the user enabled them. */
export async function connectHealth(writeNutrition = false): Promise<Result<void>> {
  if (!(await healthAvailable())) return fail('Health Connect is not available on this device.');
  try {
    await Health.requestAuthorization({ read: [...READ], write: writeNutrition ? [...WRITE_BODY, ...WRITE_NUTRITION] : [...WRITE_BODY] });
    return ok(undefined);
  } catch (e) {
    return fail((e as Error).message);
  }
}

export interface DaySample {
  date: string; // YYYY-MM-DD local
  value: number;
}

const localDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Daily values since `from`: last value per day for weight/body fat, sum per day for steps. Weight in kg. */
export async function readDaily(type: 'weight' | 'bodyFat' | 'steps', from: Date): Promise<Result<DaySample[]>> {
  if (!isNative()) return fail('Health Connect is only available in the Android app.');
  try {
    const { samples } = await Health.readSamples({ dataType: type, startDate: from.toISOString(), endDate: new Date().toISOString(), limit: 5000, ascending: true });
    const by = new Map<string, number>();
    for (const s of samples) {
      const d = localDate(s.startDate);
      by.set(d, type === 'steps' ? (by.get(d) ?? 0) + s.value : s.value);
    }
    return ok([...by.entries()].map(([date, value]) => ({ date, value })));
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function writeSample(type: WriteType, value: number, at: Date): Promise<Result<void>> {
  if (!isNative()) return fail('unavailable');
  try {
    // Nutrition and hydration are interval records: Health Connect requires start < end.
    const interval = type === 'dietaryEnergyConsumed' || type === 'dietaryWater';
    const end = interval ? new Date(at.getTime() + 60_000) : at;
    await Health.saveSample({ dataType: type, value, startDate: at.toISOString(), endDate: end.toISOString() });
    return ok(undefined);
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function openHealthSettings() {
  if (isNative()) await Health.openHealthConnectSettings().catch(() => {});
}
