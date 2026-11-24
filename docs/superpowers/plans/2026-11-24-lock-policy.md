# Lock Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lab PCs lock themselves when no class is booked in the lab and open when one is, if the Super Admin turns that on.

**Architecture:** One new switch in the school settings (kept in the `meta` table like the AI switch, so no database step). A small `LockPolicy` object on the server is ticked by a timer; it works out "is the lab booked right now?" from the periods and the timetable, and calls the existing `ScreenLocks` only when that answer changes. Lab PCs need no new code.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, zod contracts, vitest, React (System screen).

**Spec:** `docs/superpowers/specs/2026-11-24-praxis-gap-features-design.md` (feature 1).

## Global Constraints

- No internet, no new port, no new firewall rule.
- Nothing may depend on the Server PC being on at night. Locks stay in memory only.
- "Now" and "today" come from the Server PC's own clock, through the injected `Clock` (never `Date.now()`), read as local time the same way `TimetableService.today` does.
- The switch is off until the Super Admin turns it on. An installed school that upgrades sees no change.
- Teacher screens are English only; no Marathi text is needed here.
- Do not commit. The user commits when they choose.

## Calls made in this plan (Claude's, open to correction)

- The timer ticks every 15 seconds, not every minute, so a period that ends at 09:40 locks by 09:40:15. The spec's "once a minute" was a floor.
- With the switch on but an empty timetable, the policy does nothing. Otherwise a new school that turns it on before filling the timetable would lock every PC all day.
- Sunday has no lab periods, so with the switch on the lab PCs are locked all Sunday.
- When a period starts, every screen is opened, also one a teacher locked by hand in the period before.

## Review Focus

1. Switch on, timetable empty: no PC is locked. (Task 2 test)
2. A teacher unlocks by hand outside a period: the PCs stay open on the next ticks, and lock again only after a period has started and ended. (Task 2 test)
3. The switch is turned off while the policy has the lab locked: the PCs open on the next tick. (Task 2 test)
4. A PC joins the lab while the policy has the lab locked: it is locked too. (Task 2 test)
5. A settings request that leaves the new field out (an older saved form): it is taken as off, not refused. (Task 1 test)

---

### Task 1: The switch in the school settings

**Files:**
- Modify: `contracts/src/settings.ts` (`SchoolSettings`)
- Modify: `server/src/modules/settings/settings.service.ts`
- Modify: `apps/client/src/features/settings/SettingsPanel.tsx`
- Modify: `contracts/openapi.json` (made by `just openapi`, never by hand)
- Test: `server/test/settings.test.ts`

**Interfaces:**
- Produces: `SchoolSettings.lockOutsidePeriods: boolean` (zod: `z.boolean().default(false)`), and `SettingsService.lockOutsidePeriods(): boolean`.

- [ ] **Step 1: Write the failing tests** in `server/test/settings.test.ts`

```ts
it('keeps the "lock when no class is booked" switch, off to start', async () => {
  // GET on a new server
  expect((await inject('GET', '/api/v1/settings', teacher)).json().lockOutsidePeriods).toBe(false);
  // Super Admin turns it on
  const res = await inject('PUT', '/api/v1/settings', admin, { ...base, lockOutsidePeriods: true });
  expect(res.json().lockOutsidePeriods).toBe(true);
  expect((await inject('GET', '/api/v1/settings', teacher)).json().lockOutsidePeriods).toBe(true);
});

it('takes a settings form without the switch as off', async () => {
  await inject('PUT', '/api/v1/settings', admin, { ...base, lockOutsidePeriods: true });
  const res = await inject('PUT', '/api/v1/settings', admin, base);
  expect(res.statusCode).toBe(200);
  expect(res.json().lockOutsidePeriods).toBe(false);
});
```

Also add `lockOutsidePeriods: false` to the existing exact-match expectation of `GET /api/v1/settings` in this file.

- [ ] **Step 2: Run** `pnpm --filter ./server test settings` — expected: the two new tests fail.

- [ ] **Step 3: Implement.**
  - `contracts/src/settings.ts`: add `lockOutsidePeriods: z.boolean().default(false)` to `SchoolSettings`, with a one-line comment saying what it does.
  - `settings.service.ts`: flag key `'lock_outside_periods'`, default `false`. `school()` returns it, `save()` stores it inside the same transaction and adds `lock: before !== after` to the audit detail. Add `lockOutsidePeriods(): boolean`.
  - `SettingsPanel.tsx`: a second checkbox beside the AI one, id `set-lock`, label exactly: `Lock the lab PCs when no class is booked in the lab`.

- [ ] **Step 4: Run** `just openapi`, then `pnpm test` and `pnpm typecheck` — expected: all pass (the contract test checks `openapi.json`).

---

### Task 2: The policy on the server

**Files:**
- Create: `server/src/modules/devices/lock-policy.ts`
- Modify: `server/src/modules/devices/screen-locks.ts`
- Modify: `server/src/modules/devices/device-enrolment.service.ts` (tell `ScreenLocks` when a PC joins)
- Modify: `server/src/container.ts` (build it, expose as `lockPolicy`)
- Modify: `server/src/main.ts` (timer)
- Test: `server/test/lock-policy.test.ts`

**Interfaces:**
- Consumes: `SettingsService.lockOutsidePeriods()`, `SettingsRepository.periods()`, `TimetableRepository.all()`, `schoolDayOf` from `@ict/contracts`.
- Produces:
  - `labBooked(at: Date, periods: Period[], slots: { day: number; periodId: string }[]): boolean` — true when a slot of today's school day points at a period with `start <= HH:MM < end` (local time of `at`).
  - `class LockPolicy { constructor(now: Clock, enabled: () => boolean, periods: () => Period[], slots: () => Slot[], locks: ScreenLocks); tick(): void }`
  - `ScreenLocks.setAllByPolicy(locked: boolean): void` — like `setAll`, audited with actor `{ kind: 'system', id: null }` and actions `screens.autolock` / `screens.autounlock`. It also remembers the policy's state.
  - `ScreenLocks.joined(deviceId: string, kind: 'lab_pc' | 'board'): void` — called by enrolment for a new device; locks a new `lab_pc` if the policy currently has the lab locked.

**How `tick()` decides** (the one rule the signature does not fix):

```ts
// `last` is what the policy last asked for: true = locked, false = open, null = not acting.
tick() {
  const slots = this.slots();
  if (!this.enabled() || slots.length === 0) {
    if (this.last === true) this.locks.setAllByPolicy(false);
    this.last = null;
    return;
  }
  const want = !labBooked(new Date(this.now()), this.periods(), slots);
  if (want === this.last) return;       // acts only on a change, so a teacher's own lock or unlock holds
  this.locks.setAllByPolicy(want);
  this.last = want;
}
```

- [ ] **Step 1: Write the failing tests** in `server/test/lock-policy.test.ts`

Unit tests of `labBooked`, with one period `{ id: 'p1', name: 'P1', start: '09:00', end: '09:40' }` and a slot `{ day: 1, periodId: 'p1' }`. Build dates with local parts (`new Date(2026, 10, 23, h, m)`; 23 Nov 2026 is a Monday, 22 Nov a Sunday):

```ts
expect(labBooked(mon(9, 0), periods, slots)).toBe(true);    // the first minute counts
expect(labBooked(mon(9, 39), periods, slots)).toBe(true);
expect(labBooked(mon(9, 40), periods, slots)).toBe(false);  // the end minute does not
expect(labBooked(mon(8, 59), periods, slots)).toBe(false);
expect(labBooked(new Date(2026, 10, 24, 9, 10), periods, slots)).toBe(false); // Tuesday: not booked
expect(labBooked(new Date(2026, 10, 22, 9, 10), periods, slots)).toBe(false); // Sunday
```

Tests through the test server (`testServer()` from `helpers.ts`; extend it to return its `clock` and the container `c` if it does not already). Set the clock with `clock.t = new Date(2026, 10, 23, h, m).getTime()`, save one period and one Monday slot through the API, call `c.lockPolicy.tick()`, and read `GET /api/v1/devices` for which are locked:

```ts
it('locks the lab PCs outside a booked period and opens them inside it, leaving the board alone')
//  08:00 tick -> ['Lab PC 1','Lab PC 2'] locked, board not; 09:10 tick -> []; 09:40 tick -> both locked
it('does nothing while the switch is off')
//  08:00 tick -> []
it('does nothing when the timetable is empty, even with the switch on')
//  no slot saved; 08:00 tick -> []
it('leaves a teacher\'s unlock alone until a period has started and ended')
//  08:00 tick -> locked; teacher PUT /devices/lock {locked:false}; 08:01 tick -> []; 09:10 tick -> []; 09:40 tick -> locked
it('opens the PCs when the switch is turned off')
//  08:00 tick -> locked; PUT settings lockOutsidePeriods:false; tick -> []
it('locks a PC that joins while the lab is locked by the policy')
//  08:00 tick; enrol a third lab_pc; GET /devices -> 'Lab PC 3' locked
it('writes the change in the activity log as the system')
//  audit list has action 'screens.autolock' with actor kind 'system'
```

- [ ] **Step 2: Run** `pnpm --filter ./server test lock-policy` — expected: fail (module not found).

- [ ] **Step 3: Implement** `lock-policy.ts`, the two `ScreenLocks` methods, the `joined` call in enrolment, and the wiring in `container.ts`. In `main.ts`, next to the shows timer: `setInterval(() => c.lockPolicy.tick(), 15_000).unref();` and one `c.lockPolicy.tick()` right after, so a server that starts outside a period locks at once. Wrap the timer's call so an error is written to the diary (`log('lock.policy.failed', { why })`) and never stops the server.

- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint` — expected: all pass, including the old `screen-locks.test.ts` unchanged.

---

### Task 3: Words for people

**Files:**
- Modify: `docs/windows-test-guide.md` (new "Step 5a-2: Locking by the timetable", after Step 5a)
- Modify: `README.md` (one line under Super Admin → System)
- Modify: `docs/superpowers/specs/2026-11-24-praxis-gap-features-design.md` and `.html` (feature 1: the 15-second tick and the empty-timetable rule)

- [ ] **Step 1: Write the Windows steps.** They must cover: turn the switch on with a period that is running now booked for a class → student PC stays open; change the period so it has ended → within 15 seconds the student PC shows "Look at your teacher"; press Unlock all screens → it opens and stays open; turn the switch off → nothing locks. Also say to run Step 5a again.

- [ ] **Step 2: One run in the browser on the Mac** with the harness (see memory "Browser harness"): the checkbox shows on the System screen, saves, and is still ticked after a reload. Warn the user before the test browser opens, and close it after.
