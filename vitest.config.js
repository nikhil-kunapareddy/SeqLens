import { defineConfig } from 'vitest/config';
import path from 'node:path';
/**
 * Test configuration.
 *
 * Separate from `vite.config.ts` because Vite 8 no longer accepts a `test` key
 * in its own config type, and keeping it there fails the `tsc -b` step of the
 * build. The React plugin is deliberately omitted: the component-free layers
 * under test do not need the JSX transform's refresh runtime, and esbuild
 * handles the TSX in the few files that do.
 */
export default defineConfig({
    resolve: {
        alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        coverage: {
            reporter: ['text', 'html'],
            include: ['src/bio/**', 'src/storage/**', 'src/utils/**', 'src/features/reports/**'],
        },
    },
});
