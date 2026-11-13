import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

// Class 7 (Asha, Bina) with two library links and one piece of work; Class 8 (Kabir) with one link.
async function school() {
  const t = await testServer();
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST' | 'DELETE', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c7 = (await inject('POST', '/api/v1/classes', admin, { name: '7' })).json();
  const c8 = (await inject('POST', '/api/v1/classes', admin, { name: '8' })).json();
  const student = async (name: string, classId: string, rollNo: string) => {
    await inject('POST', '/api/v1/students', admin, { name, classId, rollNo });
    const device = t.auth(await t.enrolDevice('lab_pc'));
    return t.auth((await inject('POST', '/api/v1/auth/student/roll', device, { classId, rollNo })).json().token);
  };
  const asha = await student('Asha', c7.id, '1');
  const bina = await student('Bina', c7.id, '2');
  const kabir = await student('Kabir', c8.id, '1');
  const link = async (title: string, classId: string) => (await inject('POST', '/api/v1/content/links', admin, { title, url: 'https://example.org/x', classId, subject: 'Maths' })).json();
  const video = await link('Watch: fractions', c7.id);
  const reading = await link('Read: halves', c7.id);
  const other = await link('Class 8 item', c8.id);
  const work = (await inject('POST', '/api/v1/assignments', admin, { title: 'Fractions worksheet', classId: c7.id, subject: 'Maths' })).json();
  await inject('POST', '/api/v1/staff', admin, { username: 'ravi', displayName: 'Ravi K', password: 'ravi-pass1', classIds: [c7.id], subjects: ['Maths'] });
  const ravi = t.auth(await t.login('ravi', 'ravi-pass1'));
  const make = (who: object, body: object) => inject('POST', '/api/v1/sequences', who, { classId: c7.id, subject: 'Maths', ...body });
  const todo = async (who: object) => (await inject('GET', '/api/v1/todo', who)).json();
  const c = (id: string) => ({ kind: 'content', refId: id });
  const w = (id: string) => ({ kind: 'work', refId: id });
  return { ...t, inject, admin, ravi, c7, c8, asha, bina, kabir, video, reading, other, work, make, todo, c, w };
}

describe('Playlists and learning paths', () => {
  it('makes a playlist of library items in the order given', async () => {
    const { admin, video, reading, make, c } = await school();
    const res = await make(admin, { type: 'playlist', title: ' Fractions week ', steps: [c(reading.id), c(video.id)] });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ type: 'playlist', title: 'Fractions week', className: '7', subject: 'Maths' });
    expect(res.json().steps.map((s: { title: string; kind: string; available: boolean }) => [s.kind, s.title, s.available])).toEqual([['content', 'Read: halves', true], ['content', 'Watch: fractions', true]]);
  });

  it('lets a learning path mix library items and work, but keeps work out of a playlist', async () => {
    const { admin, video, work, make, c, w } = await school();
    const path = await make(admin, { type: 'path', title: 'Learn fractions', steps: [c(video.id), w(work.id)] });
    expect(path.json().steps.map((s: { kind: string; title: string }) => `${s.kind}:${s.title}`)).toEqual(['content:Watch: fractions', 'work:Fractions worksheet']);
    const bad = await make(admin, { type: 'playlist', title: 'Playlist with work', steps: [w(work.id)] });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/Step 1.*learning path/);
  });

  it("takes steps only from the same class's library and work", async () => {
    const { admin, other, make, c, w } = await school();
    const none = '00000000-0000-4000-8000-000000000000';
    expect((await make(admin, { type: 'path', title: 'x', steps: [c(other.id)] })).json().message).toMatch(/Step 1: pick an item from this class/);
    expect((await make(admin, { type: 'path', title: 'x', steps: [c(none)] })).statusCode).toBe(400);
    expect((await make(admin, { type: 'path', title: 'x', steps: [w(none)] })).statusCode).toBe(400);
    expect((await make(admin, { type: 'path', title: 'x', steps: [] })).statusCode).toBe(400);
  });

  it("shows a student their class's things to do with the next step, and ticks a step when they open it", async () => {
    const { inject, admin, asha, bina, kabir, video, reading, make, todo, c } = await school();
    await make(admin, { type: 'path', title: 'Learn fractions', steps: [c(video.id), c(reading.id)] });
    const [mine] = await todo(asha);
    expect(mine).toMatchObject({ type: 'path', title: 'Learn fractions', doneSteps: 0, nextStepId: mine.steps[0].id });
    expect(mine.steps[0].content).toMatchObject({ title: 'Watch: fractions', kind: 'link' });

    expect((await inject('POST', `/api/v1/todo/steps/${mine.steps[0].id}/done`, asha)).statusCode).toBe(204);
    await inject('POST', `/api/v1/todo/steps/${mine.steps[0].id}/done`, asha); // opening it again changes nothing
    const [after] = await todo(asha);
    expect(after.steps.map((s: { done: boolean }) => s.done)).toEqual([true, false]);
    expect(after).toMatchObject({ doneSteps: 1, nextStepId: after.steps[1].id });

    expect((await todo(bina))[0].doneSteps).toBe(0); // Bina's ticks are her own
    expect(await todo(kabir)).toEqual([]);
    expect((await inject('POST', `/api/v1/todo/steps/${mine.steps[1].id}/done`, kabir)).statusCode).toBe(404);
  });

  it('ticks a work step when the work is handed in, not by opening it', async () => {
    const { inject, admin, asha, work, make, todo, w } = await school();
    await make(admin, { type: 'path', title: 'Do the work', steps: [w(work.id)] });
    const [before] = await todo(asha);
    expect((await inject('POST', `/api/v1/todo/steps/${before.steps[0].id}/done`, asha)).json()).toMatchObject({ code: 'HAND_IN' });
    await inject('POST', `/api/v1/work/${work.id}/answers`, asha, { body: 'My answer' });
    const [after] = await todo(asha);
    expect(after).toMatchObject({ doneSteps: 1, nextStepId: null });
  });

  it('counts for the teacher how many students have finished a path', async () => {
    const { inject, admin, asha, video, work, make, todo, c, w } = await school();
    const path = (await make(admin, { type: 'path', title: 'Learn fractions', steps: [c(video.id), w(work.id)] })).json();
    expect(path).toMatchObject({ students: 2, finished: 0 });
    const [mine] = await todo(asha);
    await inject('POST', `/api/v1/todo/steps/${mine.steps[0].id}/done`, asha);
    await inject('POST', `/api/v1/work/${work.id}/answers`, asha, { body: 'Done' });
    expect((await inject('GET', '/api/v1/sequences', admin)).json()[0]).toMatchObject({ students: 2, finished: 1 });
  });

  it('skips a step whose library item was removed, and says so', async () => {
    const { inject, admin, asha, video, reading, make, todo, c } = await school();
    await make(admin, { type: 'playlist', title: 'Two items', steps: [c(video.id), c(reading.id)] });
    await inject('DELETE', `/api/v1/content/${video.id}`, admin);
    const [mine] = await todo(asha);
    expect(mine.steps[0]).toMatchObject({ title: 'Removed from the library', available: false, content: null });
    expect(mine.nextStepId).toBe(mine.steps[1].id);
  });

  it('removes a playlist from the students, and keeps a teacher to her own classes and subjects', async () => {
    const { inject, admin, ravi, c8, asha, video, other, make, todo, c } = await school();
    const mine = (await make(ravi, { type: 'playlist', title: 'Ravi list', steps: [c(video.id)] })).json();
    expect((await make(ravi, { type: 'playlist', title: 'Science list', subject: 'Science', steps: [c(video.id)] })).statusCode).toBe(403);
    expect((await make(ravi, { type: 'playlist', title: 'Class 8 list', classId: c8.id, steps: [c(other.id)] })).statusCode).toBe(403);
    const theirs = (await make(admin, { type: 'playlist', title: 'Class 8 list', classId: c8.id, steps: [c(other.id)] })).json();
    expect((await inject('GET', '/api/v1/sequences', ravi)).json().map((q: { title: string }) => q.title)).toEqual(['Ravi list']);
    expect((await inject('DELETE', `/api/v1/sequences/${theirs.id}`, ravi)).statusCode).toBe(404);

    expect((await inject('DELETE', `/api/v1/sequences/${mine.id}`, ravi)).statusCode).toBe(204);
    expect(await todo(asha)).toEqual([]);
  });

  it('is for staff to make and students to follow', async () => {
    const { inject, admin, asha, video, make, c } = await school();
    expect((await make(asha, { type: 'playlist', title: 'Mine', steps: [c(video.id)] })).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/sequences', asha)).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/todo', admin)).statusCode).toBe(403);
  });
});
