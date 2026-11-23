import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { createContainer } from '../src/container.js';
import { eventLine, type EventLog } from '../src/core/event-log.js';
import { openDb } from '../src/infra/db/index.js';
import type { Llm } from '../src/modules/ai/llm-client.js';
import type { OfficeConverter } from '../src/modules/content/office.js';

// With `ai`, a fake model stands in for llama-server; without it the server has no AI kit.
// With `office`, a stand-in for LibreOffice; without it the server has none.
export async function testServer(opts: { ai?: { llm: Llm; installed: boolean }; office?: OfficeConverter } = {}) {
  const clock = { t: 1_800_000_000_000 };
  const db = openDb(':memory:');
  const ai = opts.ai && {
    llm: opts.ai.llm,
    runtime: { installed: () => (opts.ai!.installed ? { name: 'Test model' } : null), isReady: () => opts.ai!.installed },
  };
  // Every line the server would write in its diary (events.log), as "event key=value …" without the time.
  const diary: string[] = [];
  const log: EventLog = (event, detail) => diary.push(eventLine(0, event, detail).split('  ').slice(1).join(' '));
  const c = createContainer({ db, now: () => clock.t, version: 'test', ai, office: opts.office, log });
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

  // Each test PC joins from its own address, as each lab PC does on the lab network.
  let pcs = 0;
  async function enrolDevice(kind: 'lab_pc' | 'board' = 'lab_pc'): Promise<string> {
    pcs += 1;
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/device/enrol',
      payload: { kind, appVersion: '0.1.0' },
      remoteAddress: `10.1.${Math.floor(pcs / 250)}.${(pcs % 250) + 1}`,
    });
    return res.json().token;
  }

  // Signs a student in on a lab PC of their own, the way the sign-in screen does: class, roll number
  // and name. Returns the session token.
  async function studentToken(studentId: string): Promise<string> {
    const s = db.prepare('SELECT class_id AS classId, section_id AS sectionId, roll_no AS rollNo FROM students WHERE id = ?').get(studentId) as object;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/student/roll', headers: auth(await enrolDevice('lab_pc')), payload: { ...s, studentId } });
    if (res.statusCode !== 201) throw new Error(`student sign-in failed: ${res.body}`);
    return res.json().token;
  }

  return { app, db, clock, c, login, auth, enrolDevice, studentToken, diary };
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
