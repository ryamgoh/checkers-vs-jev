import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client is built into dist/ and served by the Fastify server on one origin.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
});
