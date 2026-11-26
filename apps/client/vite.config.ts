import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The PDF reader (pdf.js) loads a few files of its own while it reads a book: the shapes of letters
// for books that do not carry their fonts, the tables for Chinese, Japanese and Korean text, and the
// small programs that unpack some kinds of scanned pictures. The app has no internet, so they are
// served from the app itself, under /pdfjs/. The code runner for scripts inside a PDF is left out.
const PDF_FILES = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
const pdfRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const pdfFiles = () => PDF_FILES.flatMap((dir) => readdirSync(join(pdfRoot, dir))
  .filter((name) => !name.startsWith('quickjs') && !name.startsWith('LICENSE'))
  .map((name) => ({ at: `pdfjs/${dir}/${name}`, from: join(pdfRoot, dir, name) })));
const TYPES: Record<string, string> = { '.js': 'text/javascript', '.wasm': 'application/wasm' };

function pdfjsFiles(): Plugin {
  return {
    name: 'pdfjs-files',
    configureServer(server) {
      const files = new Map(pdfFiles().map((f) => [`/${f.at}`, f.from]));
      server.middlewares.use((req, res, next) => {
        const from = files.get((req.url ?? '').split('?')[0] ?? '');
        if (!from) return next();
        res.setHeader('Content-Type', TYPES[extname(from)] ?? 'application/octet-stream');
        res.end(readFileSync(from));
      });
    },
    generateBundle() {
      for (const f of pdfFiles()) this.emitFile({ type: 'asset', fileName: f.at, source: readFileSync(f.from) });
    },
  };
}

// Tauri expects a fixed port and loads the built files from ../dist.
export default defineConfig({
  plugins: [react(), tailwindcss(), pdfjsFiles()],
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0') },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: 'es2022', outDir: 'dist' },
});
