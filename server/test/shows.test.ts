import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CHUNK_BYTES, INK_BATCH_MAX, INK_POINTS_MAX, INK_STROKES_MAX, SCREEN_REPORTS_MAX, SHOW_STALE_MS, showPosition, showRoom } from '@ict/contracts';
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
    const signedIn = (await inject('POST', '/api/v1/auth/student/roll', t.auth(device), { classId, rollNo: '1' })).json();
    const token = signedIn.token as string;
    return { token, as: t.auth(token), id: signedIn.principal.studentId as string };
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
    const got: (null | { id: string; playing: boolean; position: number; inkRev: number; pen: null | { studentId: string; name: string }; watching?: object[] })[] = [];
    const errors: string[] = [];
    const events: any[] = [];
    const h = t.c.relay.attach({ send: (text) => { const m = JSON.parse(text); if (m.t === 'state') got.push(m.p); if (m.t === 'event') events.push(m.p); if (m.t === 'error') errors.push(m.p.code); }, close: () => {} }, () => t.c.resolver.resolve(token));
    h.message(JSON.stringify({ t: 'join', room: showRoom(classId) }));
    return { got, errors, events, last: () => got.at(-1) };
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

  it("writes the show in the server's diary: started, playing, paused, stopped", async () => {
    const { ravi, clock, diary, start, move, inject } = await school();
    const id = (await start(ravi)).json().id as string;
    const show = id.slice(0, 8);
    await move(ravi, id, { playing: true, position: 0 });
    clock.t += 5_000;
    await move(ravi, id, { playing: true, position: 5 }); // a "still here": nothing new, so no line
    await move(ravi, id, { playing: false, position: 61.26 });
    await inject('DELETE', `/api/v1/shows/${id}`, ravi);
    expect(diary).toEqual([
      `show.started show="${show}" video="Addition of Integers" class="7" by="Ravi K"`,
      `show.playing show="${show}" at=0 speed=1`,
      `show.paused show="${show}" at=61.3 speed=1`,
      `show.stopped show="${show}" video="Addition of Integers" class="7" by="Ravi K"`,
    ]);
  });

  it("writes down what a student's screen says, with the student and the PC", async () => {
    const { ravi, asha, diary, start, inject } = await school();
    const id = (await start(ravi)).json().id as string;
    diary.length = 0;
    const say = (body: object) => inject('POST', `/api/v1/shows/${id}/screen`, asha.as, body);
    expect((await say({ event: 'opened' })).statusCode).toBe(204);
    await say({ event: 'waiting', position: 12.34, behind: 4.56 });
    expect(diary).toEqual([
      `show.screen.opened show="${id.slice(0, 8)}" student="Asha" pc="Lab PC 1" at=0 behind=0`,
      `show.screen.waiting show="${id.slice(0, 8)}" student="Asha" pc="Lab PC 1" at=12.3 behind=4.6`,
    ]);
    await inject('DELETE', `/api/v1/shows/${id}`, ravi);
    expect(diary.at(-1)).toContain('show.stopped');
    expect(diary.at(-1)).toContain('screens=1'); // how many screens spoke up during the show
  });

  it("takes a screen's report only from a student of that class, about a show that is on, and not for ever", async () => {
    const { ravi, asha, kabir, diary, start, inject } = await school();
    const id = (await start(ravi)).json().id as string;
    diary.length = 0;
    const say = (who: object, body: object, show = id) => inject('POST', `/api/v1/shows/${show}/screen`, who, body);
    expect((await say(ravi, { event: 'opened' })).statusCode).toBe(403); // a teacher is not a screen
    expect((await say(asha.as, { event: 'exploded' })).statusCode).toBe(400);
    expect((await say(kabir.as, { event: 'opened' })).statusCode).toBe(204); // another class: dropped quietly
    expect(diary).toEqual([]);
    for (let i = 0; i < SCREEN_REPORTS_MAX + 20; i++) await say(asha.as, { event: 'waiting' });
    expect(diary).toHaveLength(SCREEN_REPORTS_MAX); // one broken PC cannot fill the diary
    await inject('DELETE', `/api/v1/shows/${id}`, ravi);
    diary.length = 0;
    expect((await say(asha.as, { event: 'recovered' })).statusCode).toBe(204); // the show is over: dropped quietly
    expect(diary).toEqual([]);
  });

  it("says in the diary when a show ended because the teacher's app went quiet, or was replaced", async () => {
    const { ravi, admin, clock, diary, start, c } = await school();
    await start(ravi);
    await start(admin); // the Super Admin shows the same class something: Ravi's show is replaced
    expect(diary.filter((l) => l.startsWith('show.replaced'))).toHaveLength(1);
    diary.length = 0;
    clock.t += SHOW_STALE_MS + 1;
    c.shows.sweep();
    c.shows.sweep();
    expect(diary).toHaveLength(1); // said once, not on every sweep
    expect(diary[0]).toMatch(/^show\.gone_quiet .*class="7"/);
  });
});

describe('Writing on the video', () => {
  // Ravi is showing Class 7 the video, paused, and Asha's screen has it open.
  async function lesson() {
    const s = await school();
    const id = (await s.start(s.ravi)).json().id as string;
    await s.inject('POST', `/api/v1/shows/${id}/screen`, s.asha.as, { event: 'opened' });
    const line = (who: object, points: number[], strokeId: string = randomUUID(), look: object = {}) =>
      s.inject('POST', `/api/v1/shows/${id}/ink`, who, { strokeId, colour: 'red', width: 'medium', points, ...look });
    const ink = async (who: object) => (await s.inject('GET', `/api/v1/shows/${id}/ink`, who)).json();
    const pen = (studentId: string | null, who: object = s.ravi) => s.inject('PUT', `/api/v1/shows/${id}/pen`, who, { studentId });
    return { ...s, id, line, ink, pen };
  }

  it("sends the teacher's pen line to the class as it grows, and keeps it for a screen that comes late", async () => {
    const { ravi, asha, c7, screen, id, line, ink, mine } = await lesson();
    const pc = screen(asha.token, c7.id);
    const strokeId = randomUUID();
    expect((await line(ravi, [100, 200, 5000, 150, 250, 6000], strokeId, { colour: 'yellow', width: 'thick' })).statusCode).toBe(204);
    expect((await line(ravi, [200, 300, 7000], strokeId)).statusCode).toBe(204);
    // Each message carries only the new part of the line.
    expect(pc.events).toEqual([
      { kind: 'add', show: id, rev: 1, stroke: { id: strokeId, by: 'teacher', byName: 'Ravi K', colour: 'yellow', width: 'thick', points: [100, 200, 5000, 150, 250, 6000] } },
      { kind: 'add', show: id, rev: 2, stroke: { id: strokeId, by: 'teacher', byName: 'Ravi K', colour: 'yellow', width: 'thick', points: [200, 300, 7000] } },
    ]);
    expect(pc.got).toHaveLength(1); // the whole state is not sent again for a pen line
    expect(await ink(asha.as)).toEqual({ rev: 2, strokes: [{ id: strokeId, by: 'teacher', byName: 'Ravi K', colour: 'yellow', width: 'thick', points: [100, 200, 5000, 150, 250, 6000, 200, 300, 7000] }] });
    expect(await mine(asha.as)).toMatchObject({ inkRev: 2, pen: null });
  });

  it('wipes the writing when the video plays or jumps, and when the teacher wipes it; not on a plain "still here"', async () => {
    const { ravi, asha, c7, screen, id, line, ink, move, inject } = await lesson();
    const pc = screen(asha.token, c7.id);
    await line(ravi, [1, 1, 1]);
    await move(ravi, id, { playing: false, position: 0 });
    expect((await ink(ravi)).strokes).toHaveLength(1);
    await move(ravi, id, { playing: true, position: 0 });
    expect(pc.events.at(-1)).toEqual({ kind: 'clear', show: id, rev: 2 });
    expect(await ink(ravi)).toEqual({ rev: 2, strokes: [] });

    await move(ravi, id, { playing: false, position: 0 });
    await line(ravi, [1, 1, 1]);
    await move(ravi, id, { playing: false, position: 60 });
    expect((await ink(ravi)).strokes).toHaveLength(0);

    await line(ravi, [1, 1, 1]);
    expect((await inject('DELETE', `/api/v1/shows/${id}/ink`, ravi)).statusCode).toBe(204);
    expect(pc.events.at(-1)).toMatchObject({ kind: 'clear' });
    expect((await ink(asha.as)).strokes).toHaveLength(0);
    expect((await inject('DELETE', `/api/v1/shows/${id}/ink`, asha.as)).statusCode).toBe(403);
  });

  it('lets a student write only with the pen, which the teacher gives to one student and can take back', async () => {
    const { ravi, asha, c7, screen, line, ink, pen, mine } = await lesson();
    const pc = screen(asha.token, c7.id);
    expect((await line(asha.as, [1, 1, 1])).json()).toMatchObject({ code: 'NO_PEN' });

    const given = await pen(asha.id);
    expect(given.json()).toMatchObject({ pen: { studentId: asha.id, name: 'Asha' }, watching: [{ studentId: asha.id, name: 'Asha' }] });
    expect(pc.last()).toMatchObject({ pen: { studentId: asha.id, name: 'Asha' } });
    expect(pc.last()!.watching).toBeUndefined(); // who is watching is for the teacher only
    expect((await line(asha.as, [10, 20, 5000])).statusCode).toBe(204);
    expect((await ink(ravi)).strokes[0]).toMatchObject({ by: asha.id, byName: 'Asha', points: [10, 20, 5000] });

    expect((await pen(null)).json()).toMatchObject({ pen: null });
    expect(pc.last()).toMatchObject({ pen: null });
    expect((await line(asha.as, [1, 1, 1])).statusCode).toBe(403);
    expect(await mine(asha.as)).toMatchObject({ pen: null });
  });

  it('gives the pen only to a student who is watching, and takes it from one who signs out', async () => {
    const { ravi, asha, kabir, inject, pen, mine, admin, c7, id } = await lesson();
    expect((await pen(kabir.id)).json()).toMatchObject({ code: 'NOT_WATCHING' }); // another class
    expect((await pen(asha.id, asha.as)).statusCode).toBe(403); // a student cannot give the pen
    await pen(asha.id);
    await inject('POST', '/api/v1/auth/logout', asha.as);
    await inject('POST', '/api/v1/students', admin, { name: 'Meera', classId: c7.id, rollNo: '2' });
    const device = (await inject('POST', '/api/v1/auth/device/enrol', {}, { kind: 'lab_pc', appVersion: '0.1.0' })).json().token;
    const meera = { authorization: `Bearer ${(await inject('POST', '/api/v1/auth/student/roll', { authorization: `Bearer ${device}` }, { classId: c7.id, rollNo: '2' })).json().token}` };
    expect(await mine(meera)).toMatchObject({ id, pen: null });
    expect((await pen(asha.id)).json()).toMatchObject({ code: 'NOT_WATCHING' });
    void ravi;
  });

  it('does not let a student write on a playing video, or touch a line that is not theirs', async () => {
    const { ravi, asha, id, line, pen, move, inject, ink } = await lesson();
    await pen(asha.id);
    const teachers = randomUUID();
    await line(ravi, [1, 1, 1], teachers);
    expect((await line(asha.as, [2, 2, 2], teachers)).statusCode).toBe(403); // cannot add to the teacher's line
    expect((await inject('DELETE', `/api/v1/shows/${id}/ink/${teachers}`, asha.as)).statusCode).toBe(403);
    const own = randomUUID();
    await line(asha.as, [3, 3, 3], own);
    expect((await inject('DELETE', `/api/v1/shows/${id}/ink/${own}`, asha.as)).statusCode).toBe(204);
    expect((await inject('DELETE', `/api/v1/shows/${id}/ink/${teachers}`, ravi)).statusCode).toBe(204);
    expect((await ink(ravi)).strokes).toHaveLength(0);

    await move(ravi, id, { playing: true, position: 0 });
    expect((await line(asha.as, [1, 1, 1])).json()).toMatchObject({ code: 'SHOW_PLAYING' });
    expect((await line(ravi, [1, 1, 1])).statusCode).toBe(204); // the teacher's own pen is not held back
  });

  it("keeps writing to its own class and its own show, and refuses what is not a pen line", async () => {
    const { ravi, kabir, admin, id, line, ink, inject } = await lesson();
    await line(ravi, [1, 1, 1]);
    expect((await inject('GET', `/api/v1/shows/${id}/ink`, kabir.as)).statusCode).toBe(404);
    expect((await line(kabir.as, [1, 1, 1])).statusCode).toBe(404);
    expect((await line(admin, [1, 1, 1])).statusCode).toBe(404); // not the teacher who is showing
    expect((await line(ravi, [1, 1])).statusCode).toBe(400); // not whole points
    expect((await line(ravi, [1, 1, 10_001])).statusCode).toBe(400); // off the picture
    expect((await line(ravi, Array(INK_BATCH_MAX * 3 + 3).fill(1))).statusCode).toBe(400);
    expect((await line(ravi, [1, 1, 1], randomUUID(), { colour: 'pink' })).statusCode).toBe(400);
    expect((await ink(ravi)).strokes).toHaveLength(1);
  });

  it('stops a line and the board from growing for ever', async () => {
    const { ravi, line, ink } = await lesson();
    const long = randomUUID();
    const batch = Array(INK_BATCH_MAX * 3).fill(1);
    for (let sent = 0; sent < INK_POINTS_MAX + INK_BATCH_MAX; sent += INK_BATCH_MAX) await line(ravi, batch, long);
    expect((await ink(ravi)).strokes[0].points).toHaveLength(INK_POINTS_MAX * 3);
    for (let n = 1; n < INK_STROKES_MAX; n += 1) await line(ravi, [1, 1, 1]);
    expect((await line(ravi, [1, 1, 1])).json()).toMatchObject({ code: 'INK_FULL' });
    expect((await line(ravi, [2, 2, 2], long)).statusCode).toBe(204); // a line already there is not refused
  });

  it("writes in the diary who got the pen and when the writing was wiped, not every line", async () => {
    const { ravi, asha, id, line, pen, inject, diary } = await lesson();
    diary.length = 0;
    await line(ravi, [1, 1, 1]);
    await line(ravi, [2, 2, 2]);
    await pen(asha.id);
    await pen(null);
    await inject('DELETE', `/api/v1/shows/${id}/ink`, ravi);
    expect(diary.map((l) => l.replace(/show="[^"]+" /, ''))).toEqual([
      'show.ink.started by="Ravi K"',
      'show.pen.given student="Asha"',
      'show.pen.taken student="Asha"',
      'show.ink.cleared by="Ravi K"',
    ]);
  });
});
