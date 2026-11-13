import type { AiJob, AiJobKind } from '@ict/contracts';

// A poll reply belongs to the job it was asked about. If the teacher has started another request since,
// the late reply for the old one must not push the new one off the screen.
export function acceptPoll<T extends { id: string }>(current: T | null, incoming: T): T | null {
  return current?.id === incoming.id ? incoming : current;
}

// One missed poll is nothing; a few in a row means the server has gone away for now.
export const POLL_FAILURES_BEFORE_WARNING = 3;
export function pollTrouble(failuresInARow: number): string | null {
  return failuresInARow >= POLL_FAILURES_BEFORE_WARNING ? 'Cannot reach the server. Still trying…' : null;
}

export const isOpen = (j: { status: AiJob['status'] }) => j.status === 'queued' || j.status === 'running';

// The server lets each person have one open AI request across all kinds, so a quiz still being made
// blocks a question, and the other way round.
export function otherKindOpen(jobs: AiJob[], kind: AiJobKind): boolean {
  return jobs.some((j) => j.kind !== kind && isOpen(j));
}
