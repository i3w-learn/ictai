import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed port and loads the built files from ../dist.
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0') },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: 'es2022', outDir: 'dist' },
});
