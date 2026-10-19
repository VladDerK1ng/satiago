import { LocalNotifications } from '@capacitor/local-notifications';
import { fail, isNative, ok, type Result } from './native';

const CHECKIN_ID = 1001;
const WEIGH_ID = 1002;

export interface ReminderPlan {
  checkIn?: { weekday: number; minute: number }; // weekday 0 = Monday
  weighIn?: { minute: number };
  /** Exact timing; needs Android's "Alarms & reminders" permission (see requestPreciseReminders). */
  precise?: boolean;
}

/** Replace all scheduled reminders with `plan`. No-op on web. */
export async function scheduleReminders(plan: ReminderPlan): Promise<Result<void>> {
  if (!isNative()) return ok(undefined);
  try {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return fail('Notifications are blocked for Satiago in Android settings.');
    await LocalNotifications.cancel({ notifications: [{ id: CHECKIN_ID }, { id: WEIGH_ID }] });
    const list = [];
    if (plan.checkIn) {
      list.push({
        id: CHECKIN_ID,
        title: 'Your weekly check-in is ready',
        body: 'Review your week and get updated targets.',
        // Capacitor weekday: 1 = Sunday … 7 = Saturday
        schedule: { on: { weekday: ((plan.checkIn.weekday + 1) % 7) + 1, hour: Math.floor(plan.checkIn.minute / 60), minute: plan.checkIn.minute % 60 }, allowWhileIdle: true },
        extra: { route: '/checkin' },
        // Inexact by default (may arrive up to ~1 h late) so Android never shows its
        // "Alarms & reminders" screen unasked; precise timing is an opt-in setting.
        isExactNotification: !!plan.precise,
      });
    }
    if (plan.weighIn) {
      list.push({
        id: WEIGH_ID,
        title: 'Morning weigh-in',
        body: 'A quick weigh-in keeps your trend and expenditure accurate.',
        schedule: { on: { hour: Math.floor(plan.weighIn.minute / 60), minute: plan.weighIn.minute % 60 }, allowWhileIdle: true },
        extra: { route: '/more/body' },
        isExactNotification: !!plan.precise,
      });
    }
    if (list.length) await LocalNotifications.schedule({ notifications: list });
    return ok(undefined);
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** Route to open when the user taps a reminder. */
export function onReminderTap(cb: (route: string) => void) {
  if (!isNative()) return () => {};
  const h = LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    const route = (a.notification.extra as { route?: string } | undefined)?.route;
    if (route) cb(route);
  });
  return () => {
    h.then((x) => x.remove());
  };
}

/** Whether exact alarms are allowed (always true below Android 12). */
export async function preciseRemindersAllowed(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    return (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted';
  } catch {
    return false;
  }
}

/** Opens Android's "Alarms & reminders" screen; resolves with the resulting state. */
export async function requestPreciseReminders(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    return (await LocalNotifications.changeExactNotificationSetting()).exact_alarm === 'granted';
  } catch {
    return false;
  }
}

/** Posts a notification right away so the user can check that notifications reach them. */
export async function sendTestNotification(): Promise<Result<void>> {
  if (!isNative()) return fail('Notifications only work in the Android app.');
  try {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return fail('Notifications are blocked for Satiago in Android settings.');
    await LocalNotifications.schedule({
      notifications: [{ id: 1999, title: 'Satiago reminders work', body: 'Tap to open your body metrics.', extra: { route: '/more/body' }, isExactNotification: false }],
    });
    return ok(undefined);
  } catch (e) {
    return fail((e as Error).message);
  }
}
