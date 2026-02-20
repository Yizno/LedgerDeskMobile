import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../Booking Keeping/packages/shared/src'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
      '@mobile': path.resolve(__dirname, './src/mobile'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
});
