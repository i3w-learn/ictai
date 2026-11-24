import { schoolDayOf, type Period } from '@ict/contracts';
import type { Clock } from '../../core/clock.js';
import type { ScreenLocks } from './screen-locks.js';

const two = (n: number) => String(n).padStart(2, '0');

// Whether a class has the lab at this moment: a slot of today's school day whose period is running.
// A period runs from its first minute up to, not including, its end ("09:00" to "09:40" ends at 09:40).
// The time is the Server PC's own clock, as everywhere else in the timetable.
export function labBooked(at: Date, periods: Period[], slots: { day: number; periodId: string }[]): boolean {
  const day = schoolDayOf(at);
  if (day === null) return false;
  const time = `${two(at.getHours())}:${two(at.getMinutes())}`;
  const running = new Set(periods.filter((p) => p.start <= time && time < p.end).map((p) => p.id));
  return slots.some((s) => s.day === day && running.has(s.periodId));
}

// The lab PCs lock themselves when no class is booked in the lab, and open when one is, if the
// Super Admin has switched that on. Looked at every few seconds by a timer (see main.ts).
// It acts only when the answer changes (a period starts or ends), so a teacher who locks or unlocks
// by hand in between is left alone until then.
// With no class in the timetable at all it does nothing: a school that switches this on before
// filling its timetable must not find every PC locked all day.
export class LockPolicy {
  // What the policy last asked for: true = locked, false = open, null = it is not acting.
  private last: boolean | null = null;

  constructor(
    private readonly now: Clock,
    private readonly enabled: () => boolean,
    private readonly periods: () => Period[],
    private readonly slots: () => { day: number; periodId: string }[],
    private readonly locks: ScreenLocks,
  ) {}

  tick() {
    const slots = this.slots();
    if (!this.enabled() || slots.length === 0) {
      // Opens the lab only if the lock is still the policy's own: a teacher who has since unlocked
      // and locked by hand keeps what she set.
      if (this.locks.lockedByPolicy()) this.locks.setAllByPolicy(false);
      this.last = null;
      return;
    }
    const want = !labBooked(new Date(this.now()), this.periods(), slots);
    if (want === this.last) return;
    // Just switched on (or the timetable got its first class) while a class is in the lab: there is
    // nothing of the policy's to open, and screens a teacher locked by hand must stay locked.
    if (this.last !== null || want) this.locks.setAllByPolicy(want);
    this.last = want;
  }
}
