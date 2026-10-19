// Writes public/third-party-licenses.txt: the license of every runtime npm package bundled into
// the app, with its full license text. Run `npm run licenses` after changing dependencies.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));

const entries = Object.entries(lock.packages)
  .filter(([path, p]) => path.startsWith('node_modules/') && !p.dev && !p.devOptional && !p.optional)
  .map(([path, p]) => ({ path, name: path.slice(path.lastIndexOf('node_modules/') + 13), version: p.version, license: p.license }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const seen = new Set();
const sections = [];
for (const e of entries) {
  const key = `${e.name}@${e.version}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const dir = join(root, e.path);
  const file = existsSync(dir) ? readdirSync(dir).find((f) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(f)) : undefined;
  const text = file ? readFileSync(join(dir, file), 'utf8').trim() : '(No license file in the package; see its package.json and repository.)';
  sections.push(`${'='.repeat(78)}\n${key}  ·  ${e.license ?? 'see text'}\n${'='.repeat(78)}\n${text}\n`);
}

const header = `Satiago third-party licenses
============================

Satiago is licensed under the GNU GPL v3.0 or later (see LICENSE and NOTICE in the source code).
It includes the open-source JavaScript packages listed below, each under its own license.

The Android app additionally uses: Capacitor and its plugins (MIT), AndroidX libraries
(Apache-2.0), and Google ML Kit barcode scanning and Google Play services libraries (Google's
terms: https://developers.google.com/ml-kit/terms). The Manrope typeface is under the SIL Open
Font License 1.1 (Copyright 2019 The Manrope Project Authors).

Generated from package-lock.json: ${seen.size} packages.

`;
writeFileSync(join(root, 'public', 'third-party-licenses.txt'), header + sections.join('\n'));
console.log(`wrote public/third-party-licenses.txt with ${seen.size} packages`);
