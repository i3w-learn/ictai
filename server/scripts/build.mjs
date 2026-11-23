// Makes dist/server.cjs, the one file the Windows installer ships as the server.
// When ICT_CONTENT_KEY is set (GitHub sets it from a secret), the key that opens our locked videos
// is written into that file. Without it the server is built the same, but cannot open locked files.
import { build } from 'esbuild';

const key = process.env.ICT_CONTENT_KEY ?? '';
if (key && !/^[0-9a-f]{64}$/i.test(key)) {
  console.error('ICT_CONTENT_KEY must be 64 letters and digits (hex).');
  process.exit(1);
}

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['better-sqlite3'],
  outfile: 'dist/server.cjs',
  define: key ? { __ICT_CONTENT_KEY__: JSON.stringify(key) } : {},
  logLevel: 'info',
});
console.log(key ? 'Built with the key for locked videos.' : 'Built WITHOUT a key: this server cannot open locked videos.');
