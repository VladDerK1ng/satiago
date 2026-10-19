import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { fail, isNative, ok, type Result } from './native';

// Product barcodes plus QR codes (GS1 Digital Link QR codes on newer packaging carry the GTIN).
const FORMATS = [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.UpcE, BarcodeFormat.Code128, BarcodeFormat.QrCode];

export interface ScanSession {
  stop: () => Promise<void>;
  setTorch: (on: boolean) => Promise<void>;
  torchAvailable: boolean;
}

/**
 * Native: ML Kit (bundled model) renders the camera behind the WebView; the caller shows its own
 * overlay and must keep the rest of the UI hidden via `body.barcode-scanner-active`.
 * Web: returns 'web' so the caller uses the BarcodeDetector fallback.
 */
export async function startNativeScan(onCode: (code: string) => void): Promise<Result<ScanSession> | 'web'> {
  if (!isNative()) return 'web';
  try {
    const perm = await BarcodeScanner.requestPermissions();
    if (perm.camera !== 'granted' && perm.camera !== 'limited') return fail('Camera permission was denied. Enable it in Android settings to scan barcodes.');
    // The camera renders behind the WebView: the whole document must be transparent.
    document.documentElement.classList.add('barcode-scanner-active');
    document.body.classList.add('barcode-scanner-active');
    // Every detection is reported; the caller decides which code to accept.
    const listener = await BarcodeScanner.addListener('barcodesScanned', (ev) => {
      for (const b of ev.barcodes) if (b.rawValue) onCode(b.rawValue);
    });
    await BarcodeScanner.startScan({ formats: FORMATS });
    const torch = await BarcodeScanner.isTorchAvailable().catch(() => ({ available: false }));
    return ok({
      torchAvailable: torch.available,
      setTorch: async (on) => {
        if (on) await BarcodeScanner.enableTorch();
        else await BarcodeScanner.disableTorch();
      },
      stop: async () => {
        document.documentElement.classList.remove('barcode-scanner-active');
        document.body.classList.remove('barcode-scanner-active');
        await listener.remove();
        await BarcodeScanner.stopScan().catch(() => {});
      },
    });
  } catch (e) {
    document.documentElement.classList.remove('barcode-scanner-active');
    document.body.classList.remove('barcode-scanner-active');
    return fail(`Scanner unavailable: ${(e as Error).message}`);
  }
}

export interface WebBarcodeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
export type WebBarcodeDetectorCtor = new (opts?: { formats?: string[] }) => WebBarcodeDetector;

/**
 * Barcode detection in browsers: the built-in BarcodeDetector where it exists (Chrome on Android),
 * otherwise an on-device WebAssembly decoder (Safari on iPhone). The decoder's .wasm file is bundled
 * with the app and served from the app's own origin, never from a CDN (AD-7).
 */
export async function webBarcodeDetector(): Promise<WebBarcodeDetectorCtor | undefined> {
  const builtIn = (globalThis as unknown as { BarcodeDetector?: WebBarcodeDetectorCtor }).BarcodeDetector;
  if (builtIn) return builtIn;
  try {
    const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
      import('barcode-detector/ponyfill'),
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ]);
    prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
    return BarcodeDetector as unknown as WebBarcodeDetectorCtor;
  } catch {
    return undefined;
  }
}
