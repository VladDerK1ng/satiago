import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gtinFromScan } from '../domain/off';
import { startNativeScan, webBarcodeDetector, type ScanSession } from '../platform/barcode';
import { haptic } from '../platform/haptics';
import { useBackHandler } from '../ui/backStack';

/**
 * Full-screen scanner. In the Android app ML Kit draws the camera behind the WebView and this
 * overlay frames it; in browsers it uses the BarcodeDetector API, with manual entry as fallback.
 */
export function BarcodeScanner({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<ScanSession | null>(null);
  const [mode, setMode] = useState<'native' | 'web' | 'manual'>('native');
  const [error, setError] = useState<string>();
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState('');
  useBackHandler(open, onClose);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let stream: MediaStream | undefined;
    setError(undefined);
    setTorch(false);
    let accepted = false;
    const found = (raw: string) => {
      if (stopped || accepted) return;
      const code = gtinFromScan(raw);
      if (!code) {
        setError('That code is not a product barcode. Point the camera at the barcode on the package.');
        return;
      }
      accepted = true;
      haptic('scan');
      onCode(code);
    };
    (async () => {
      const r = await startNativeScan(found);
      if (r !== 'web') {
        if (r.ok) {
          session.current = r.value;
          setMode('native');
          if (stopped) await r.value.stop();
        } else {
          setError(r.reason);
          setMode('manual');
        }
        return;
      }
      const Detector = await webBarcodeDetector();
      if (stopped) return;
      if (!Detector) {
        setMode('manual');
        setError('Camera scanning is not supported in this browser. Type the barcode number instead.');
        return;
      }
      setMode('web');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!video.current || stopped) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] });
        while (!stopped) {
          const codes = await detector.detect(video.current).catch(() => []);
          for (const c of codes) if (c.rawValue) found(c.rawValue);
          if (accepted) return;
          await new Promise((res) => setTimeout(res, 200));
        }
      } catch (e) {
        setMode('manual');
        setError(`Camera unavailable: ${(e as Error).message}`);
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
      session.current?.stop();
      session.current = null;
    };
  }, [open, onCode]);

  if (!open) return null;
  return createPortal(
    <div className={`scanner-overlay ${mode !== 'native' ? 'web' : ''}`} role="dialog" aria-label="Scan barcode">
      <div className="row between">
        <button className="scan-btn" aria-label="Close scanner" onClick={onClose}>
          ✕
        </button>
        <b>Scan a barcode</b>
        {mode === 'native' && session.current?.torchAvailable ? (
          <button
            className={`scan-btn ${torch ? 'on' : ''}`}
            aria-label="Toggle flashlight"
            aria-pressed={torch}
            onClick={async () => {
              await session.current?.setTorch(!torch);
              setTorch(!torch);
            }}
          >
            ϟ
          </button>
        ) : (
          <span style={{ width: 52 }} />
        )}
      </div>

      {mode !== 'manual' && (
        <div className="scan-window">
          {mode === 'web' && <video ref={video} muted playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />}
          <motion.div className="scan-line" animate={{ top: ['12%', '88%', '12%'] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }} />
        </div>
      )}

      <div>
        {error && <p style={{ textAlign: 'center', opacity: 0.9 }}>{error}</p>}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) onCode(manual.trim());
          }}
        >
          <input className="field" inputMode="numeric" placeholder="Or type the number" value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))} style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', borderColor: 'transparent' }} />
          <button className="btn primary" disabled={!manual}>
            Look up
          </button>
        </form>
        <p className="tiny" style={{ textAlign: 'center', opacity: 0.7 }}>
          Scanning happens on your phone. Unknown codes are looked up in Open Food Facts.
        </p>
      </div>
    </div>,
    document.body,
  );
}
