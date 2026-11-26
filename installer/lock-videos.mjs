#!/usr/bin/env node
// Locks videos and books so that they play only inside ICT App.
//
//   node installer/lock-videos.mjs <file or folder>... [--out <folder>]
//
// For each .mp4, .webm or .pdf it writes a locked copy named "<name>.ictlock" (beside the file, or
// in the --out folder). The file you gave is left as it is: keep it somewhere safe and give out
// only the .ictlock copy. A locked copy opens in no player; only an ICT App server built with the
// same key can play it.
//
// The key is 64 letters and digits. It is read from ICT_CONTENT_KEY, or from the file
// ~/.ict/content-key. The same key must be the GitHub secret ICT_CONTENT_KEY, which the build writes
// into the server. Lose the key and the locked copies can never be opened; leak it and they all can.
//
// The layout of a locked file is described in server/src/modules/content/lock.ts. This file uses
// nothing but Node itself, so it runs anywhere Node does.
import { createCipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const LOCK_EXT = '.ictlock';
const CAN_LOCK = /\.(mp4|webm|pdf)$/i;

function readKey() {
  const file = join(homedir(), '.ict', 'content-key');
  const hex = (process.env.ICT_CONTENT_KEY || (existsSync(file) ? readFileSync(file, 'utf8') : '')).trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    console.error(`No key found. Set ICT_CONTENT_KEY, or put the key (64 letters and digits) in ${file}`);
    process.exit(1);
  }
  return Buffer.from(hex, 'hex');
}

async function lock(key, from, to) {
  const start = randomBytes(16);
  const out = createWriteStream(`${to}.part`);
  out.write(Buffer.concat([Buffer.from('ICTLOCK1', 'latin1'), start]));
  await pipeline(createReadStream(from), createCipheriv('aes-256-ctr', key, start), out);
  // The finished name appears only when the whole file is written.
  renameSync(`${to}.part`, to);
}

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const outDir = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
if (args.length === 0 || (outAt >= 0 && !outDir)) {
  console.error('Use: node installer/lock-videos.mjs <file or folder>... [--out <folder>]');
  process.exit(1);
}

const key = readKey();
if (outDir) mkdirSync(outDir, { recursive: true });
const files = args.flatMap((a) => (statSync(a).isDirectory() ? readdirSync(a).map((f) => join(a, f)) : [a])).filter((f) => CAN_LOCK.test(f));
if (files.length === 0) {
  console.error('Nothing to lock: no .mp4, .webm or .pdf was found.');
  process.exit(1);
}
for (const from of files) {
  const to = join(outDir ?? dirname(from), basename(from) + LOCK_EXT);
  await lock(key, from, to);
  console.log(`locked  ${to}`);
}
console.log(`\n${files.length} locked. Give out only the ${LOCK_EXT} files; keep the originals to yourself.`);
