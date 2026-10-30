import { mkdtempSync, writeFileSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiRuntime, type ChildLike, type Spawner } from '../src/modules/ai/runtime.js';
import { LlamaServerLlm } from '../src/modules/ai/llm-client.js';

function aiDir(withModel = true) {
  const dir = mkdtempSync(join(tmpdir(), 'ict-ai-'));
  if (withModel) {
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ name: 'Gemma 4 31B', file: 'model.gguf', sha256: 'x', ctx: 8192 }));
    writeFileSync(join(dir, 'model.gguf'), 'weights');
    writeFileSync(join(dir, 'llama-server'), 'bin');
  }
  return dir;
}

function fakeSpawner() {
  const children: { args: string[]; exit: (code: number | null) => void; fail: (err: Error) => void; killed: boolean }[] = [];
  const spawner: Spawner = {
    spawn(_bin, args) {
      let onExit: (code: number | null) => void = () => {};
      let onError: (err: Error) => void = () => {};
      const rec = { args, exit: (code: number | null) => onExit(code), fail: (err: Error) => onError(err), killed: false };
      children.push(rec);
      const child: ChildLike = {
        pid: 4000 + children.length,
        on: ((e: 'exit' | 'error', fn: never) => { if (e === 'exit') onExit = fn; else onError = fn; }) as ChildLike['on'],
        kill: () => { rec.killed = true; },
      };
      return child;
    },
  };
  return { spawner, children };
}

// Health replies in order; the last one repeats.
const health = (...codes: number[]) => {
  const queue = [...codes];
  return vi.fn(async (_url: string | URL | Request) => new Response('', { status: queue.length > 1 ? queue.shift()! : queue[0]! }));
};
// Nothing listening on the port until the child is spawned.
const healthAfterSpawn = (...codes: number[]) => {
  const inner = health(...codes);
  let first = true;
  return vi.fn(async (url: string | URL | Request) => {
    if (first) { first = false; throw new Error('ECONNREFUSED'); }
    return inner(url);
  });
};

function runtime(dir: string, fetchFn: typeof fetch, spawner: Spawner, setPriority = vi.fn()) {
  const rt = new AiRuntime({ dir, port: 7702, threads: null, bin: null }, spawner, fetchFn, setPriority, { pollMs: 1, maxWaitMs: 1000 });
  return { rt, setPriority };
}

describe('AI runtime', () => {
  it('not installed without a manifest', async () => {
    const { spawner } = fakeSpawner();
    const { rt } = runtime(aiDir(false), health(200), spawner);
    expect(rt.installed()).toBeNull();
    await expect(rt.ensureReady()).rejects.toMatchObject({ code: 'AI_NOT_INSTALLED' });
  });

  it('starts llama-server on localhost at low priority', async () => {
    const { spawner, children } = fakeSpawner();
    const { rt, setPriority } = runtime(aiDir(), healthAfterSpawn(200), spawner);
    expect(rt.installed()).toEqual({ name: 'Gemma 4 31B' });
    await rt.ensureReady();
    const args = children[0]!.args.join(' ');
    expect(args).toContain('--host 127.0.0.1');
    expect(args).toContain('--port 7702');
    expect(setPriority).toHaveBeenCalledWith(4001, constants.priority.PRIORITY_LOW);
    expect(rt.isReady()).toBe(true);
  });

  it('thinks by default and can be told not to', async () => {
    const on = fakeSpawner();
    await runtime(aiDir(), healthAfterSpawn(200), on.spawner).rt.ensureReady();
    expect(on.children[0]!.args.join(' ')).toContain('--reasoning on');

    const dir = aiDir();
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ name: 'm', file: 'model.gguf', sha256: 'x', ctx: 8192, reasoning: 'off' }));
    const off = fakeSpawner();
    await runtime(dir, healthAfterSpawn(200), off.spawner).rt.ensureReady();
    expect(off.children[0]!.args.join(' ')).toContain('--reasoning off');
  });

  it('waits for /health and starts only once', async () => {
    const { spawner, children } = fakeSpawner();
    const fetchFn = healthAfterSpawn(503, 503, 200);
    const { rt } = runtime(aiDir(), fetchFn, spawner);
    await Promise.all([rt.ensureReady(), rt.ensureReady()]);
    expect(children).toHaveLength(1);
    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(String(fetchFn.mock.calls[1]![0])).toBe('http://127.0.0.1:7702/health');
  });

  it('restarts after the process exits', async () => {
    const { spawner, children } = fakeSpawner();
    // The port answers only while a spawned child is alive.
    let alive = 0;
    const fetchFn = vi.fn(async () => {
      if (!alive) throw new Error('ECONNREFUSED');
      return new Response('', { status: 200 });
    });
    const counting: Spawner = { spawn: (b, a) => { alive++; return spawner.spawn(b, a); } };
    const { rt } = runtime(aiDir(), fetchFn, counting);
    await rt.ensureReady();
    alive--;
    children[0]!.exit(1);
    expect(rt.isReady()).toBe(false);
    await rt.ensureReady();
    expect(children).toHaveLength(2);
  });

  it('a spawn error fails the start instead of crashing, and the next start tries again', async () => {
    const { spawner, children } = fakeSpawner();
    const { rt } = runtime(aiDir(), health(503), spawner);
    const first = rt.ensureReady();
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0]!.fail(new Error('EACCES'));
    await expect(first).rejects.toThrow();
    const second = rt.ensureReady();
    await vi.waitFor(() => expect(children).toHaveLength(2));
    children[1]!.fail(new Error('EACCES'));
    await expect(second).rejects.toThrow();
  });

  it('refuses to start after stop', async () => {
    const { spawner, children } = fakeSpawner();
    const { rt } = runtime(aiDir(), health(200), spawner);
    rt.stop();
    await expect(rt.ensureReady()).rejects.toThrow();
    expect(children).toHaveLength(0);
  });

  it('uses a server already answering on the port instead of starting a second one', async () => {
    const { spawner, children } = fakeSpawner();
    const { rt } = runtime(aiDir(), health(200), spawner);
    await rt.ensureReady();
    expect(children).toHaveLength(0);
    expect(rt.isReady()).toBe(true);
  });

  it('markDown makes the next request check again', async () => {
    const { spawner, children } = fakeSpawner();
    const { rt } = runtime(aiDir(), healthAfterSpawn(200), spawner);
    await rt.ensureReady();
    rt.markDown();
    expect(rt.isReady()).toBe(false);
    await rt.ensureReady();
    expect(children).toHaveLength(1);
  });

  it('stop kills the process', async () => {
    const { spawner, children } = fakeSpawner();
    const { rt } = runtime(aiDir(), healthAfterSpawn(200), spawner);
    await rt.ensureReady();
    rt.stop();
    expect(children[0]!.killed).toBe(true);
  });
});

describe('LlamaServerLlm', () => {
  it('a dropped connection marks the runtime down', async () => {
    const markDown = vi.fn();
    const fetchFn = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const llm = new LlamaServerLlm({ ensureReady: async () => {}, markDown, baseUrl: 'http://x' }, fetchFn);
    await expect(llm.json({ system: 's', user: 'u', schema: z.object({}), maxTokens: 5, signal: new AbortController().signal })).rejects.toThrow();
    expect(markDown).toHaveBeenCalled();
  });

  it('parses schema output', async () => {
    const fetchFn = vi.fn(async () => Response.json({ choices: [{ message: { content: '{"choice":2}' } }] }));
    const llm = new LlamaServerLlm({ ensureReady: async () => {}, markDown: () => {}, baseUrl: 'http://127.0.0.1:7702' }, fetchFn);
    const out = await llm.json({ system: 's', user: 'u', schema: z.object({ choice: z.number() }), maxTokens: 50, signal: new AbortController().signal });
    expect(out).toEqual({ choice: 2 });
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:7702/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body.response_format.type).toBe('json_schema');
    expect(body.messages).toEqual([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }]);
  });

  it('rejects output that does not match the schema', async () => {
    const fetchFn = vi.fn(async () => Response.json({ choices: [{ message: { content: '{"choice":"two"}' } }] }));
    const llm = new LlamaServerLlm({ ensureReady: async () => {}, markDown: () => {}, baseUrl: 'http://x' }, fetchFn);
    await expect(llm.json({ system: 's', user: 'u', schema: z.object({ choice: z.number() }), maxTokens: 50, signal: new AbortController().signal })).rejects.toThrow();
  });
});
