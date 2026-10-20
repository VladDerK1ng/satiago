import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The About page shows the version from package.json unless the build sets one explicitly.
process.env.VITE_APP_VERSION ??= JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Separate heavy vendors so the app shell parses faster on phones.
        manualChunks: {
          charts: ['recharts'],
          motion: ['motion'],
        },
      },
    },
  },
});
