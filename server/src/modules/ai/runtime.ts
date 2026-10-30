import { spawn } from 'node:child_process';
import { existsSync, openSync, readFileSync } from 'node:fs';
import { constants, setPriority as osSetPriority } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { AiConfig } from '../../config.js';
import { aiNotInstalled } from '../../core/errors.js';

// What the USB kit puts next to the model file. Thinking before answering makes Gemma 4 more
// accurate but slower; it is on unless the kit says otherwise.
const Manifest = z.object({
  name: z.string(),
  file: z.string(),
  sha256: z.string(),
  ctx: z.number().int().positive(),
  reasoning: z.enum(['on', 'off']).default('on'),
});
export type Manifest = z.infer<typeof Manifest>;

export interface ChildLike {
  pid?: number;
  on(event: 'exit', fn: (code: number | null) => void): void;
  kill(): void;
}
export interface Spawner {
  spawn(bin: string, args: string[]): ChildLike;
}

// Real spawner: llama-server's own output goes to ai.log next to the model.
export const nodeSpawner = (logFile: string): Spawner => ({
  spawn(bin, args) {
    const log = openSync(logFile, 'a');
    return spawn(bin, args, { stdio: ['ignore', log, log], windowsHide: true });
  },
});

export const serverBinName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

// Spec 9: runs llama.cpp's llama-server on localhost only, at low priority so live lessons win the CPU.
// Started on first use; if it dies, the next request starts it again.
export class AiRuntime {
  private child: ChildLike | null = null;
  private starting: Promise<void> | null = null;
  private ready = false;

  constructor(
    private readonly cfg: AiConfig,
    private readonly spawner: Spawner,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly setPriority: (pid: number, priority: number) => void = osSetPriority,
    private readonly timing = { pollMs: 1000, maxWaitMs: 10 * 60_000 },
  ) {}

  get baseUrl() {
    return `http://127.0.0.1:${this.cfg.port}`;
  }

  private manifest(): Manifest | null {
    try {
      const m = Manifest.parse(JSON.parse(readFileSync(join(this.cfg.dir, 'manifest.json'), 'utf8')));
      return existsSync(join(this.cfg.dir, m.file)) && existsSync(this.bin()) ? m : null;
    } catch {
      return null;
    }
  }

  private bin() {
    return this.cfg.bin ?? join(this.cfg.dir, serverBinName);
  }

  installed(): { name: string } | null {
    const m = this.manifest();
    return m && { name: m.name };
  }

  isReady() {
    return this.ready;
  }

  ensureReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    this.starting ??= this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async start() {
    const m = this.manifest();
    if (!m) throw aiNotInstalled();
    if (!this.child) {
      const args = ['-m', join(this.cfg.dir, m.file), '--host', '127.0.0.1', '--port', String(this.cfg.port), '-c', String(m.ctx), '--jinja', '--reasoning', m.reasoning];
      if (this.cfg.threads) args.push('-t', String(this.cfg.threads));
      const child = this.spawner.spawn(this.bin(), args);
      child.on('exit', () => {
        if (this.child === child) this.child = null;
        this.ready = false;
      });
      this.child = child;
      if (child.pid) this.setPriority(child.pid, constants.priority.PRIORITY_LOW);
    }
    // A 33 GB model takes a while to load; /health answers 503 until it is ready.
    const deadline = Date.now() + this.timing.maxWaitMs;
    while (Date.now() < deadline) {
      if (!this.child) throw new Error('llama-server exited while starting');
      try {
        if ((await this.fetchFn(`${this.baseUrl}/health`)).ok) {
          this.ready = true;
          return;
        }
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, this.timing.pollMs));
    }
    throw new Error('llama-server did not become ready in time');
  }

  stop() {
    this.child?.kill();
    this.child = null;
    this.ready = false;
  }
}
