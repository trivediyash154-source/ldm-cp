/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so dist/ can be served from any sub-path.
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['test/unit/**/*.test.ts', 'test/firmware/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
