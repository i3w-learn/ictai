import { describe, expect, it } from 'vitest';
import { createContainer } from '../src/container.js';
import { AuditLog } from '../src/core/audit.js';
import { DAY } from '../src/core/clock.js';
import { openDb } from '../src/infra/db/index.js';

// Spec 9: what people typed to the AI is kept 90 days. The activity log keeps a copy of the quiz
// topic (and the question asked), so that copy has to go at 90 days too. The log line itself stays.
describe('AI text in the activity log', () => {
  const START = 1_800_000_000_000;

  function seeded() {
    const clock = { t: START };
    const db = openDb(':memory:');
    const audit = new AuditLog(db, () => clock.t);
    const staff = { kind: 'staff' as const, id: null };
    audit.record(staff, 'ai.quiz.request', 'job-old', { topic: 'Fractions' });
    audit.record(staff, 'ai.ask.request', 'job-old-2', { question: 'Why is the sky blue?' });
    audit.record(staff, 'quiz.open', 'run-old', { quizId: 'q1' });
    clock.t += 89 * DAY;
    audit.record(staff, 'ai.quiz.request', 'job-new', { topic: 'Decimals' });
    clock.t += 2 * DAY; // the first three are now 91 days old, the last one 2 days old
    const details = () => Object.fromEntries(audit.list().map((e) => [e.target, e.detail]));
    return { clock, db, audit, details };
  }

  it('forgets AI text older than 90 days and keeps everything else', () => {
    const { clock, audit, details } = seeded();
    audit.forgetAiText(clock.t - 90 * DAY);
    expect(details()).toEqual({
      'job-old': null,
      'job-old-2': null,
      'run-old': { quizId: 'q1' },
      'job-new': { topic: 'Decimals' },
    });
    expect(audit.list()).toHaveLength(4);
  });

  it('happens by itself when the server starts', () => {
    const { clock, db, details } = seeded();
    createContainer({ db, now: () => clock.t, version: 'test' });
    expect(details()['job-old']).toBeNull();
    expect(details()['job-new']).toEqual({ topic: 'Decimals' });
  });
});
