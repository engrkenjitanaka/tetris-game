import { defineConfig } from 'vite';

export default defineConfig({
  // Root is the default (project root where index.html lives)
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: true,
  },
});
