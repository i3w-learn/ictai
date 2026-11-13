import { describe, expect, it } from 'vitest';
import type { AiJob } from '@ict/contracts';
import { acceptPoll, otherKindOpen, pollTrouble } from './ai-jobs';

const job = (id: string, kind: AiJob['kind'], status: AiJob['status']) => ({ id, kind, status }) as AiJob;

describe('AI job screens', () => {
  it('a late poll reply for an older job never replaces the job on screen', () => {
    const shown = job('b', 'ask', 'queued');
    expect(acceptPoll(shown, job('a', 'ask', 'done'))).toBe(shown);
    const fresh = job('b', 'ask', 'done');
    expect(acceptPoll(shown, fresh)).toBe(fresh);
    expect(acceptPoll(null, fresh)).toBeNull();
  });

  it('says the server cannot be reached only after a few failed polls in a row', () => {
    expect(pollTrouble(0)).toBeNull();
    expect(pollTrouble(2)).toBeNull();
    expect(pollTrouble(3)).toBe('Cannot reach the server. Still trying…');
  });

  it('knows when a request of another kind is still in progress', () => {
    expect(otherKindOpen([job('1', 'quiz', 'running'), job('2', 'ask', 'done')], 'ask')).toBe(true);
    expect(otherKindOpen([job('1', 'quiz', 'done'), job('2', 'ask', 'queued')], 'ask')).toBe(false);
    expect(otherKindOpen([], 'quiz')).toBe(false);
  });
});
