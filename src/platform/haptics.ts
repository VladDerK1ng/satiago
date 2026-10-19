import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNative } from './native';

export type HapticEvent = 'add' | 'scan' | 'select' | 'success' | 'warning';

let enabled = true;
export const setHapticsEnabled = (v: boolean) => {
  enabled = v;
};

const WEB: Record<HapticEvent, number | number[]> = {
  add: 12,
  scan: 25,
  select: 6,
  success: [14, 60, 22],
  warning: [30, 50, 30],
};

/** Named haptic events (AD-10). Never throws. */
export async function haptic(e: HapticEvent): Promise<void> {
  if (!enabled) return;
  try {
    if (!isNative()) {
      navigator.vibrate?.(WEB[e]);
      return;
    }
    switch (e) {
      case 'add':
        return await Haptics.impact({ style: ImpactStyle.Light });
      case 'scan':
        return await Haptics.impact({ style: ImpactStyle.Medium });
      case 'select':
        return await Haptics.selectionChanged();
      case 'success':
        return await Haptics.notification({ type: NotificationType.Success });
      case 'warning':
        return await Haptics.notification({ type: NotificationType.Warning });
    }
  } catch {
    /* haptics unavailable */
  }
}
