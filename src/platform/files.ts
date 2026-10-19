import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { blobToBase64 } from './camera';
import { fail, isNative, ok, type Result } from './native';

/** Save an export. Native: write to cache and open the Android share sheet. Web: download. */
export async function saveExport(name: string, data: string | Blob, mime = 'application/json'): Promise<Result<void>> {
  if (!isNative()) {
    const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return ok(undefined);
  }
  try {
    const res =
      typeof data === 'string'
        ? await Filesystem.writeFile({ path: name, data, directory: Directory.Cache, encoding: Encoding.UTF8 })
        : await Filesystem.writeFile({ path: name, data: await blobToBase64(data), directory: Directory.Cache });
    await Share.share({ title: name, url: res.uri, dialogTitle: 'Save or share export' });
    return ok(undefined);
  } catch (e) {
    const msg = (e as Error).message ?? '';
    return /cancel/i.test(msg) ? ok(undefined) : fail(msg);
  }
}

/** Let the user choose a file to import (works on web and in the Android WebView). */
export function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0]);
    input.click();
  });
}
