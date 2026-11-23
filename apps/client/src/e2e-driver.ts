// Temporary: the real app in three real windows (a teacher and two students), each pressing what is on
// its own screen. The teacher shows a video to the class; the students' screens follow. Not part of the repo.
const human: string[] = [];
for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, (e) => { if (e.isTrusted) human.push(`${type} at ${Math.round(performance.now() / 1000)} s`); }, true);
let who = 'unknown';
const report: Record<string, unknown> = { checks: [] as unknown[], human, log: [] as unknown[], marks: [] as unknown[] };
const send = () => fetch(`/__report?who=${who}`, { method: 'POST', body: JSON.stringify(report) }).catch(() => undefined);
const check = (name: string, ok: boolean, extra?: string) => { (report.checks as unknown[]).push({ name, ok, extra }); void send(); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = () => document.body.innerText;
const until = async (what: string, test: () => unknown, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = await test(); if (r) return r; await sleep(150); } throw new Error(`waited ${ms / 1000} s for: ${what}. Screen says: ${text().replace(/\s+/g, ' ').slice(0, 240)}`); };
const button = (re: RegExp) => [...document.querySelectorAll('button')].find((b) => re.test(b.innerText.trim()) && !b.disabled) as HTMLButtonElement | undefined;
const press = async (re: RegExp) => { const b = (await until(`button ${re}`, () => button(re))) as HTMLButtonElement; b.click(); await sleep(400); };
const type = (el: HTMLInputElement, value: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); };
const label = (l: string) => document.querySelector(`[aria-label="${l}"]`) as HTMLElement | null;
const board = async (set?: Record<string, unknown>) => (await fetch('/__state', set ? { method: 'POST', body: JSON.stringify(set) } : undefined)).json() as Promise<Record<string, any>>;
const when = (flag: string, ms = 240000) => until(`"${flag}" on the notice board`, async () => (await board())[flag], ms);
const overlay = () => document.querySelector('[role="dialog"][aria-label^="Your teacher is showing"]');

async function teacher() {
  type(document.getElementById('username') as HTMLInputElement, 'ravi');
  type(document.getElementById('password') as HTMLInputElement, 'ravi-pass1');
  await sleep(200); await press(/Sign in/);
  await until('the staff home screen', () => document.getElementById('content-title'));
  await when('s1ready'); await when('s2ready');
  await press(/^Open$/);
  const v = (await until('the teacher\'s player', () => { const e = document.querySelector('video'); return e && e.readyState >= 2 ? e : null; }, 60000)) as HTMLVideoElement;
  check('teacher Ravi opens the video in the real Server PC app; it offers "Show to Class 7"', !!button(/^Show to Class 7$/) && v.src.startsWith('ictfile:'));
  const mark = (what: string) => { (report.marks as unknown[]).push({ what, t: Date.now(), pos: v.currentTime, paused: v.paused, rate: v.playbackRate }); void send(); };
  await board({ pressedAt: Date.now() });
  await press(/^Show to Class 7$/);
  await until('the "class can see this" bar', () => /Class 7 can see this now\./.test(text()));
  check('the teacher\'s screen says "Class 7 can see this now" and offers "Stop showing"', !!button(/^Stop showing$/));
  await when('s1open', 20000); await when('s2open', 20000);
  await sleep(2000); mark('shown, not started yet');
  label('Play')!.click(); await sleep(8000); mark('playing for 8 s');
  await sleep(6000); mark('playing for 14 s');
  label('Pause')!.click(); await sleep(3500); mark('paused');
  await board({ shot: 'paused' }); await when('paused-done', 30000).catch(() => undefined);
  for (let i = 0; i < 3; i++) { label('Forward 10 seconds')!.click(); await sleep(700); }
  await sleep(3500); mark('jumped forward 30 s while paused');
  label('Play')!.click(); await sleep(7000); mark('playing again for 7 s');
  (document.querySelector('[aria-label^="Speed"]') as HTMLElement).click(); await sleep(8000); mark('at 1.25× speed for 8 s');
  for (let i = 0; i < 3; i++) (document.querySelector('[aria-label^="Speed"]') as HTMLElement).click();
  await sleep(500);
  type(document.querySelector('.player-seek') as HTMLInputElement, '140'); await sleep(6000); mark('jumped to 2:20 while playing, 6 s later');
  label('Back 10 seconds')!.click(); await sleep(5000); mark('back 10 s while playing, 5 s later');
  await board({ shot: 'playing' }); await when('playing-done', 30000).catch(() => undefined);
  await sleep(1500); mark('still playing');
  await board({ stoppedAt: Date.now() });
  await press(/^Stop showing$/);
  await until('the Show to class button again', () => button(/^Show to Class 7$/));
  check('"Stop showing" puts the teacher\'s screen back to normal; her own video stays', !!document.querySelector('video') && !/can see this now/.test(text()));
  await when('s1closed', 20000); await when('s2closed', 20000);
  await sleep(1500);
  await press(/^Show to Class 7$/);
  await when('s1open2', 20000); await when('s2open2', 20000);
  await sleep(3000);
  check('a second show opens on both screens again', true, `human input: ${human.join(', ') || 'none'}`);
  report.finished = true; await send();
  await board({ killTeacher: Date.now() });
}

async function student(n: 1 | 2) {
  const name = n === 1 ? 'Asha' : 'Bina';
  await press(/^7$/);
  await until('roll number box', () => document.getElementById('roll-no'));
  type(document.getElementById('roll-no') as HTMLInputElement, String(n));
  await press(/^Next$/);
  await until('the "is that you" question', () => /Are you (Asha|Bina)\?/.test(text()));
  await press(/Yes, that is me/);
  await until('student home', () => button(/Open my books/));
  if (n === 2) { await press(/Open my books/); await until('My books', () => button(/Addition of Integers/)); }
  const under = n === 2 ? 'My books' : 'her home screen';
  check(`${name} signed in on her own lab PC in the real student app and is on ${under}`, !overlay());
  await board({ [`s${n}ready`]: true });
  const watch = async (round: string) => {
    await until('the teacher\'s video to open by itself', overlay, 120000);
    const openedAt = Date.now();
    const v = (await until('the video in it', () => { const e = overlay()?.querySelector('video') as HTMLVideoElement | null; return e && e.readyState >= 1 ? e : null; }, 30000)) as HTMLVideoElement;
    await board({ [`s${n}open${round}`]: true });
    return { v, openedAt, pressedAt: (await board()).pressedAt as number };
  };
  const first = await watch('');
  check('the teacher\'s video opened on this screen by itself', true, `${((first.openedAt - first.pressedAt) / 1000).toFixed(1)} s after the teacher pressed "Show to Class 7"`);
  check('it is streamed from the Server PC, and there is nothing to press except the sound', first.v.src.startsWith('ictfile:') && !first.v.controls && overlay()!.querySelectorAll('button').length === 1, [...overlay()!.querySelectorAll('button')].map((x) => x.getAttribute('aria-label') ?? x.innerText).join(' | '));
  const log = report.log as unknown[];
  let soundSeen = false;
  const diary = setInterval(() => { const v = overlay()?.querySelector('video') as HTMLVideoElement | null; if (v) { log.push({ t: Date.now(), pos: +v.currentTime.toFixed(3), paused: v.paused, rate: v.playbackRate }); if (!v.paused && !v.muted) soundSeen = true; } }, 200);
  const posting = setInterval(() => void send(), 3000);
  await until('the teacher to stop showing', () => !overlay(), 240000);
  const stoppedAt = (await board()).stoppedAt as number;
  check('the video played with sound by itself (the student pressed nothing)', soundSeen);
  check('when the teacher stops showing, the video leaves this screen', true, `${((Date.now() - stoppedAt) / 1000).toFixed(1)} s after "Stop showing"`);
  check(`and ${name} is back exactly where she was (${under})`, n === 2 ? !!button(/Addition of Integers/) : !!button(/Open my books/));
  await board({ [`s${n}closed`]: true });
  await watch('2');
  const killed = (await when('killTeacher', 60000)) as number;
  await until('the video to leave after the teacher\'s app closed', () => !overlay(), 60000).then(
    () => check('the teacher\'s app was closed without stopping: the video leaves this screen by itself', true, `${((Date.now() - killed) / 1000).toFixed(0)} s after her app closed`),
    () => check('the teacher\'s app was closed without stopping: the video leaves this screen by itself', false, 'still showing after 60 s'));
  clearInterval(diary); clearInterval(posting);
  check('no real person touched this window during the run', human.length === 0, human.join(', ') || 'none');
}

async function run() {
  const first = (await until('a sign-in screen', () => (/Which class are you in\?/.test(text()) ? 'student' : document.getElementById('username') ? 'staff' : null), 60000)) as string;
  who = first === 'staff' ? 'teacher' : await (await fetch('/__claim')).text();
  await (who === 'teacher' ? teacher() : student(who === 's1' ? 1 : 2));
}
run().catch((e) => check('the run finished', false, String(e?.message ?? e))).finally(() => { report.finished = true; void send(); });
