import type { Clock } from '../../core/clock.js';

// Spec 3: lock out after 5 wrong tries for 5 minutes. Kept in memory; a restart clears it.
export class FailureLimiter {
  private entries = new Map<string, { fails: number; blockedUntil: number }>();

  constructor(
    private readonly now: Clock,
    private readonly maxFails = 5,
    private readonly blockMs = 5 * 60_000,
  ) {}

  blockedFor(key: string): number {
    const e = this.entries.get(key);
    if (!e) return 0;
    const left = e.blockedUntil - this.now();
    if (left > 0) return left;
    if (e.blockedUntil) this.entries.delete(key);
    return 0;
  }

  fail(key: string) {
    const e = this.entries.get(key) ?? { fails: 0, blockedUntil: 0 };
    e.fails += 1;
    if (e.fails >= this.maxFails) {
      e.blockedUntil = this.now() + this.blockMs;
      e.fails = 0;
    }
    this.entries.set(key, e);
  }

  succeed(key: string) {
    this.entries.delete(key);
  }
}
