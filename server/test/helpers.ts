import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { createContainer } from '../src/container.js';
import { openDb } from '../src/infra/db/index.js';
import type { Llm } from '../src/modules/ai/llm-client.js';

// With `ai`, a fake model stands in for llama-server; without it the server has no AI kit.
export async function testServer(opts: { ai?: { llm: Llm; installed: boolean } } = {}) {
  const clock = { t: 1_800_000_000_000 };
  const db = openDb(':memory:');
  const ai = opts.ai && {
    llm: opts.ai.llm,
    runtime: { installed: () => (opts.ai!.installed ? { name: 'Test model' } : null), isReady: () => opts.ai!.installed },
  };
  const c = createContainer({ db, now: () => clock.t, version: 'test', ai });
  c.aiQueue.start();
  c.identity.setCertFingerprint('AA:BB');
  await c.staffAuth.upsertAccount({ username: 'admin', password: 'admin-pass', role: 'super_admin' });
  await c.staffAuth.upsertAccount({ username: 'teacher', password: 'teacher-pass', role: 'teacher' });
  const app = buildApp(c);
  await app.ready();

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function login(username: string, password: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/staff', payload: { username, password } });
    return res.json().token;
  }

  async function enrolDevice(kind: 'lab_pc' | 'board' = 'lab_pc'): Promise<string> {
    const staff = await login('admin', 'admin-pass');
    const { code } = (await app.inject({ method: 'POST', url: '/api/v1/devices/enrol-window', headers: auth(staff), payload: {} })).json();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/device/enrol',
      payload: { code, kind, name: `${kind}-1`, appVersion: '0.1.0' },
    });
    return res.json().token;
  }

  return { app, db, clock, c, login, auth, enrolDevice };
}

// Collects every message a socket receives, and lets a test wait for the next one of a type.
export function inbox(ws: WebSocket) {
  const got: { t: string; room?: string; seq?: number; id?: string; p?: any }[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (d) => {
    got.push(JSON.parse(d.toString()));
    waiters.splice(0).forEach((w) => w());
  });
  async function next(t: string, after = 0) {
    for (;;) {
      const hit = got.slice(after).find((m) => m.t === t);
      if (hit) return hit;
      await new Promise<void>((r) => waiters.push(r));
    }
  }
  return { got, next };
}

// Opens the live socket as whoever `headers` signs in. Listens from onInit, so the hello
// sent straight after connecting isn't missed.
export async function openRelay(app: FastifyInstance, headers: Record<string, string>) {
  let box!: ReturnType<typeof inbox>;
  const ws = await app.injectWS('/relay', { headers }, { onInit: (w: WebSocket) => { box = inbox(w); } });
  return { ws, ...box };
}
