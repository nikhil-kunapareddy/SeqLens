import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// SeqLens is a fully client-side application: there is no server component,
// no proxy, and no API layer. The build output is a static bundle.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) requires the function form. Recharts is split out
        // because only the analysis pages need it: the landing page and the
        // import flow load without the charting library at all.
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/victory-vendor')) {
            return 'charts';
          }
          if (id.includes('node_modules/dexie')) return 'storage';
          if (
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/react/')
          ) {
            return 'vendor';
          }
          return undefined;
        },
      },
    },
  },
});
