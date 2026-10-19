import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
