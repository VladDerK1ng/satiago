import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { fail, isNative, ok, type Result } from './native';

/** Ask the user for a photo. Native uses the system camera/gallery; web uses a file picker. */
export async function pickPhoto(source: 'camera' | 'gallery' | 'prompt' = 'prompt'): Promise<Result<Blob>> {
  if (isNative()) {
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Uri,
        source: source === 'camera' ? CameraSource.Camera : source === 'gallery' ? CameraSource.Photos : CameraSource.Prompt,
        quality: 85,
        width: 1600,
        correctOrientation: true,
      });
      if (!photo.webPath) return fail('No photo returned.');
      return ok(await (await fetch(photo.webPath)).blob());
    } catch (e) {
      const msg = (e as Error).message ?? '';
      return fail(/cancel/i.test(msg) ? 'cancelled' : msg || 'Camera unavailable.');
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (source === 'camera') input.capture = 'environment';
    input.onchange = () => {
      const f = input.files?.[0];
      resolve(f ? ok(f) : fail('cancelled'));
    };
    input.click();
  });
}

/** Downscale to a JPEG no larger than `max` px on the long edge. */
export async function downscale(blob: Blob, max = 1280, quality = 0.85): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', quality));
}

export async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
