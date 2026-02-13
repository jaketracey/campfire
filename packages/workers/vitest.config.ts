import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@campfire/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/**/*.d.ts', 'dist/'],
    },
    setupFiles: ['./tests/setup.ts'],
    globals: true,
  },
});
