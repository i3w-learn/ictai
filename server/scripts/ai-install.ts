// Copies an AI kit (manifest.json, the model file, llama-server) into the server's AI folder
// and checks the model's sha256 against the manifest. Usage: tsx scripts/ai-install.ts <kit folder>
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { serverBinName } from '../src/modules/ai/runtime.js';

const kit = process.argv[2];
if (!kit) throw new Error('Give the folder of the AI kit, e.g. just ai-install E:\\ict-ai-kit');

const manifest = JSON.parse(readFileSync(join(kit, 'manifest.json'), 'utf8')) as { name: string; file: string; sha256: string };

const sha256 = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });

console.log(`Checking ${manifest.file}… (a large model takes a few minutes)`);
const actual = await sha256(join(kit, manifest.file));
if (actual !== manifest.sha256) {
  console.error(`Not installed: ${manifest.file} is damaged or incomplete (checksum does not match). Copy the kit again.`);
  process.exit(1);
}

const dir = loadConfig().ai.dir;
mkdirSync(dir, { recursive: true });
for (const f of [manifest.file, serverBinName, 'manifest.json']) copyFileSync(join(kit, f), join(dir, f));
console.log(`AI installed: ${manifest.name} → ${dir}`);
