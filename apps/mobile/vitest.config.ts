import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Mobile unit tests run under the repository's pinned Vitest. Only pure
 * modules are tested here (no React Native runtime), so the Node environment
 * is sufficient and fast.
 */
export default defineConfig({
  // Vite 8's Oxc transform cannot resolve the mobile app's `expo/tsconfig.base`
  // subpath. Tests are plain TypeScript, so point Vite at a minimal config.
  tsconfig: './tsconfig.vitest.json',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
});
