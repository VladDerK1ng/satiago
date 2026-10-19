import { App as CapApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { Style, StatusBar } from '@capacitor/status-bar';
import { isNative } from './native';

export async function hideSplash() {
  if (isNative()) await SplashScreen.hide().catch(() => {});
}

/** Match status-bar icon color to the active theme. Status bar overlays the WebView (edge-to-edge). */
export async function syncStatusBar(theme: 'dark' | 'light') {
  if (!isNative()) return;
  await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light }).catch(() => {});
}

/**
 * Android back button: `handler` returns true when it consumed the event (closed a sheet,
 * navigated back). Otherwise the app exits from a root screen.
 */
export function onBackButton(handler: () => boolean) {
  if (!isNative()) return () => {};
  const h = CapApp.addListener('backButton', () => {
    if (!handler()) CapApp.exitApp();
  });
  return () => {
    h.then((x) => x.remove());
  };
}

/** Deep links such as satiago://scan from launcher shortcuts. */
export function onDeepLink(cb: (route: string) => void) {
  if (!isNative()) return () => {};
  const h = CapApp.addListener('appUrlOpen', (e) => {
    try {
      const u = new URL(e.url);
      cb(`/${u.host}${u.pathname === '/' ? '' : u.pathname}${u.search}`);
    } catch {
      /* ignore malformed */
    }
  });
  return () => {
    h.then((x) => x.remove());
  };
}
