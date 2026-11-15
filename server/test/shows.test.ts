import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES, SHOW_STALE_MS, showPosition, showRoom } from '@ict/contracts';
import { testServer } from './helpers.js';

const mp4 = (size = 2000) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(size - 12, 1)]);
const pdf = () => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20)]);

// Class 7 (Asha) and Class 8 (Kabir). Ravi teaches Maths to Class 7; Tara teaches Class 7 but may not host lessons.
async function school() {
  const t = await testServer();
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c7 = (await inject('POST', '/api/v1/classes', admin, { name: '7' })).json();
  const c8 = (await inject('POST', '/api/v1/classes', admin, { name: '8' })).json();
  const student = async (name: string, classId: string) => {
    await inject('POST', '/api/v1/students', admin, { name, classId, rollNo: '1' });
    const device = await t.enrolDevice('lab_pc');
    const token = (await inject('POST', '/api/v1/auth/student/roll', t.auth(device), { classId, rollNo: '1' })).json().token as string;
    return { token, as: t.auth(token) };
  };
  const asha = await student('Asha', c7.id);
  const kabir = await student('Kabir', c8.id);
  await inject('POST', '/api/v1/staff', admin, { username: 'ravi', displayName: 'Ravi K', password: 'ravi-pass1', classIds: [c7.id], subjects: ['Maths'] });
  const raviToken = await t.login('ravi', 'ravi-pass1');
  const ravi = t.auth(raviToken);
  const upload = async (who: object, bytes: Buffer, filing: object) => {
    const { uploadId } = (await inject('POST', '/api/v1/content/uploads', who, { fileName: 'f.bin', size: bytes.length })).json();
    await inject('PUT', `/api/v1/content/uploads/${uploadId}/chunks`, who, { index: 0, data: bytes.subarray(0, CHUNK_BYTES).toString('base64') });
    return (await inject('POST', `/api/v1/content/uploads/${uploadId}/finish`, who, filing)).json();
  };
  const video = await upload(admin, mp4(), { title: 'Addition of Integers', classId: c7.id, subject: 'Maths' });
  // A screen listening to its class's room; collects every state it is sent.
  const screen = (token: string, classId: string) => {
    const got: (null | { id: string; playing: boolean; position: number })[] = [];
    const errors: string[] = [];
    const h = t.c.relay.attach({ send: (text) => { const m = JSON.parse(text); if (m.t === 'state') got.push(m.p); if (m.t === 'error') errors.push(m.p.code); }, close: () => {} }, () => t.c.resolver.resolve(token));
    h.message(JSON.stringify({ t: 'join', room: showRoom(classId) }));
    return { got, errors, last: () => got.at(-1) };
  };
  const start = (who: object, contentId = video.id) => inject('POST', '/api/v1/shows', who, { contentId });
  const move = (who: object, id: string, body: object) => inject('PUT', `/api/v1/shows/${id}`, who, body);
  const mine = async (who: object) => (await inject('GET', '/api/v1/shows/mine', who)).json();
  return { ...t, inject, admin, ravi, raviToken, c7, c8, asha, kabir, video, upload, screen, start, move, mine };
}

describe('Show to class', () => {
  it("opens the teacher's video on the class's screens the moment she starts showing it", async () => {
    const { ravi, asha, c7, video, screen, start, mine } = await school();
    const pc = screen(asha.token, c7.id);
    expect(pc.got).toEqual([null]); // nothing is being shown yet
    const res = await start(ravi);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ classId: c7.id, className: '7', byName: 'Ravi K', playing: false, position: 0, rate: 1, item: { id: video.id, title: 'Addition of Integers', fileHash: video.fileHash } });
    expect(pc.last()).toMatchObject({ id: res.json().id, playing: false, position: 0 });
    expect(await mine(asha.as)).toMatchObject({ id: res.json().id }); // the same answer for a screen that asks instead of listening
  });

  it('sends play, pause, a jump and a change of speed to the screens at once', async () => {
    const { ravi, asha, c7, clock, screen, start, move } = await school();
    const pc = screen(asha.token, c7.id);
    const id = (await start(ravi)).json().id;
    await move(ravi, id, { playing: true, position: 0 });
    expect(pc.last()).toMatchObject({ playing: true, position: 0, rate: 1 });
    clock.t += 10_000;
    await move(ravi, id, { playing: false, position: 10 });
    expect(pc.last()).toMatchObject({ playing: false, position: 10 });
    await move(ravi, id, { playing: false, position: 95.5 });
    expect(pc.last()).toMatchObject({ playing: false, position: 95.5 });
    await move(ravi, id, { playing: true, position: 95.5, rate: 1.25 });
    expect(pc.last()).toMatchObject({ playing: true, rate: 1.25 });
  });

  it('lets a screen work out where the video is now, also one that joins late', async () => {
    const { ravi, asha, c7, clock, screen, start, move } = await school();
    const id = (await start(ravi)).json().id;
    await move(ravi, id, { playing: true, position: 10 });
    clock.t += 12_000;
    const late = screen(asha.token, c7.id).last()!;
    expect(showPosition(late as never)).toBeCloseTo(22, 5); // 10 s in, playing for 12 s
    expect(showPosition(late as never, 3000)).toBeCloseTo(25, 5); // and 3 s after the screen got it
    await move(ravi, id, { playing: true, position: 22, rate: 2 });
    clock.t += 4_000;
    expect(showPosition(screen(asha.token, c7.id).last() as never)).toBeCloseTo(30, 5); // double speed
    await move(ravi, id, { playing: false, position: 30, rate: 2 });
    clock.t += 9_000;
    expect(showPosition(screen(asha.token, c7.id).last() as never)).toBe(30); // paused: it stays
  });

  it('does not bother the screens with a "still here" that changes nothing', async () => {
    const { ravi, asha, c7, clock, screen, start, move } = await school();
    const pc = screen(asha.token, c7.id);
    const id = (await start(ravi)).json().id;
    await move(ravi, id, { playing: true, position: 0 });
    const before = pc.got.length;
    clock.t += 5_000;
    expect((await move(ravi, id, { playing: true, position: 5.1 })).statusCode).toBe(200); // right where it should be
    expect(pc.got.length).toBe(before);
    clock.t += 5_000;
    await move(ravi, id, { playing: true, position: 40 }); // the teacher skipped ahead
    expect(pc.got.length).toBe(before + 1);
  });

  it("takes the video off the screens when the teacher stops, and when her app goes quiet", async () => {
    const { inject, ravi, asha, c7, clock, c, screen, start, move, mine } = await school();
    const pc = screen(asha.token, c7.id);
    const first = (await start(ravi)).json().id;
    expect((await inject('DELETE', `/api/v1/shows/${first}`, ravi)).statusCode).toBe(204);
    expect(pc.last()).toBeNull();
    expect(await mine(asha.as)).toBeNull();

    const second = (await start(ravi)).json().id;
    clock.t += SHOW_STALE_MS - 1000;
    await move(ravi, second, { playing: true, position: 0 }); // she is still there
    clock.t += SHOW_STALE_MS - 1000;
    expect(await mine(asha.as)).toMatchObject({ id: second });
    clock.t += 2000; // nothing heard for longer than the limit
    c.shows.sweep();
    expect(pc.last()).toBeNull();
    expect(await mine(asha.as)).toBeNull();
    // A show lost by silence is "not found", not "over": the teacher's app may start it again.
    expect((await move(ravi, second, { playing: true, position: 5 })).statusCode).toBe(404);
  });

  it("keeps a show to its own class: another class's student neither hears nor sees it", async () => {
    const { ravi, asha, kabir, c7, c8, screen, start, mine } = await school();
    const other = screen(kabir.token, c8.id);
    const spy = screen(kabir.token, c7.id); // Kabir tries Class 7's room
    await start(ravi);
    expect(other.got).toEqual([null]);
    expect(spy.got).toEqual([]);
    expect(spy.errors).toEqual(['FORBIDDEN']);
    expect(await mine(kabir.as)).toBeNull();
    expect(await mine(asha.as)).not.toBeNull();
  });

  it('lets only the teacher who is showing move or stop it, and replaces a show when a new one starts', async () => {
    const { inject, admin, ravi, asha, c7, screen, start, move } = await school();
    const pc = screen(asha.token, c7.id);
    const id = (await start(ravi)).json().id;
    expect((await move(admin, id, { playing: true, position: 50 })).statusCode).toBe(404);
    expect((await inject('DELETE', `/api/v1/shows/${id}`, admin)).statusCode).toBe(404);
    expect(pc.last()).toMatchObject({ id, playing: false });
    const next = (await start(admin)).json().id; // the Super Admin shows the class something
    expect(pc.last()).toMatchObject({ id: next });
    // Ravi's app is told plainly that his show is over (so it does not start it again by itself)...
    expect((await move(ravi, id, { playing: true, position: 1 })).json()).toMatchObject({ code: 'SHOW_OVER' });
    // ...and so is the Super Admin's after stopping.
    await inject('DELETE', `/api/v1/shows/${next}`, admin);
    expect((await move(admin, next, { playing: true, position: 1 })).statusCode).toBe(410);
  });

  it('refuses what cannot be shown, and people who may not show', async () => {
    const { inject, admin, ravi, asha, c7, c8, upload, start, move } = await school();
    const doc = await upload(admin, pdf(), { title: 'Book', classId: c7.id, subject: 'Maths' });
    expect((await start(ravi, doc.id)).json().message).toBe('Only a video can be shown to the class.');
    const science = await upload(admin, mp4(3000), { title: 'Science video', classId: c7.id, subject: 'Science' });
    expect((await start(ravi, science.id)).statusCode).toBe(404); // not her subject
    const forEight = await upload(admin, mp4(4000), { title: 'Class 8 video', classId: c8.id, subject: 'Maths' });
    expect((await start(ravi, forEight.id)).statusCode).toBe(404); // not her class
    expect((await start(asha.as)).statusCode).toBe(403);
    expect((await start({})).statusCode).toBe(401);
    const id = (await start(ravi)).json().id;
    expect((await move(ravi, id, { playing: true, position: -1 })).statusCode).toBe(400);
    expect((await move(asha.as, id, { playing: true, position: 1 })).statusCode).toBe(403);
    // A teacher the Super Admin has not allowed to host lessons cannot show.
    const staff = (await inject('GET', '/api/v1/staff', admin)).json().find((s: { username: string }) => s.username === 'ravi');
    await inject('PATCH', `/api/v1/staff/${staff.id}`, admin, { canHostLessons: false });
    expect((await start(ravi)).statusCode).toBe(403);
  });

  it('ends the show when its video is removed from the library', async () => {
    const { inject, admin, ravi, asha, video, start, mine } = await school();
    await start(ravi);
    await inject('DELETE', `/api/v1/content/${video.id}`, admin);
    expect(await mine(asha.as)).toBeNull();
  });
});
