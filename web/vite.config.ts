import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.JUMPCUT_API || 'http://127.0.0.1:5174';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target: API, changeOrigin: true, ws: false },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
});
