import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.vladderk1ng.satiago',
  appName: 'Satiago',
  webDir: 'dist',
  backgroundColor: '#0B0D0C',
  android: {
    // No remote content: the app ships its own web assets.
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    // Native HTTP for fetch(): avoids WebView CORS limits on Open Food Facts' search service.
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: false,
      launchFadeOutDuration: 250,
      backgroundColor: '#0B0D0C',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
      backgroundColor: '#00000000',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_satiago',
      iconColor: '#2BB673',
    },
  },
};

export default config;
