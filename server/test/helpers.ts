import { buildApp } from '../src/app.js';
import { createContainer } from '../src/container.js';
import { openDb } from '../src/infra/db/index.js';

export async function testServer() {
  const clock = { t: 1_800_000_000_000 };
  const db = openDb(':memory:');
  const c = createContainer({ db, now: () => clock.t, version: 'test' });
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
