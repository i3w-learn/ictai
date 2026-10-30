import type { AiJob, AiQuizRequest, AiQuizResult } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

interface JobRow {
  id: string;
  requested_by: string;
  request_json: string;
  status: AiJob['status'];
  result_json: string | null;
  error: string | null;
  created_at: number;
  finished_at: number | null;
  position: number | null;
}

// Place in line = queued jobs inserted at or before this one (rowid follows insert order).
const SELECT = `
  SELECT j.*, CASE WHEN j.status = 'queued'
    THEN (SELECT COUNT(*) FROM ai_jobs q WHERE q.status = 'queued' AND q.rowid <= j.rowid) END AS position
  FROM ai_jobs j`;

const toJob = (r: JobRow): AiJob => ({
  id: r.id,
  kind: 'quiz',
  status: r.status,
  position: r.position,
  request: JSON.parse(r.request_json) as AiQuizRequest,
  result: r.result_json ? (JSON.parse(r.result_json) as AiQuizResult) : null,
  error: r.error,
  createdAt: r.created_at,
  finishedAt: r.finished_at,
});

export class JobRepository {
  constructor(private readonly db: Db) {}

  insert(id: string, userId: string, request: AiQuizRequest, now: number) {
    this.db
      .prepare(`INSERT INTO ai_jobs (id, kind, requested_by, request_json, status, created_at) VALUES (?, 'quiz', ?, ?, 'queued', ?)`)
      .run(id, userId, JSON.stringify(request), now);
  }

  get(id: string): AiJob | null {
    const row = this.db.prepare(`${SELECT} WHERE j.id = ?`).get(id) as JobRow | undefined;
    return row ? toJob(row) : null;
  }

  ownerOf(id: string): string | null {
    return (this.db.prepare('SELECT requested_by FROM ai_jobs WHERE id = ?').pluck().get(id) as string | undefined) ?? null;
  }

  listFor(userId: string, limit: number): AiJob[] {
    const rows = this.db.prepare(`${SELECT} WHERE j.requested_by = ? ORDER BY j.created_at DESC, j.rowid DESC LIMIT ?`).all(userId, limit) as JobRow[];
    return rows.map(toJob);
  }

  hasOpen(userId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM ai_jobs WHERE requested_by = ? AND status IN ('queued','running')`).get(userId);
  }

  queuedCount(): number {
    return this.db.prepare(`SELECT COUNT(*) FROM ai_jobs WHERE status = 'queued'`).pluck().get() as number;
  }

  nextQueued(): AiJob | null {
    const row = this.db.prepare(`${SELECT} WHERE j.status = 'queued' ORDER BY j.rowid LIMIT 1`).get() as JobRow | undefined;
    return row ? toJob(row) : null;
  }

  markRunning(id: string, now: number) {
    this.db.prepare(`UPDATE ai_jobs SET status = 'running', started_at = ? WHERE id = ?`).run(now, id);
  }

  markDone(id: string, result: AiQuizResult, now: number) {
    this.db.prepare(`UPDATE ai_jobs SET status = 'done', result_json = ?, finished_at = ? WHERE id = ?`).run(JSON.stringify(result), now, id);
  }

  markFailed(id: string, error: string, now: number) {
    this.db.prepare(`UPDATE ai_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`).run(error, now, id);
  }

  failRunning(error: string, now: number) {
    this.db.prepare(`UPDATE ai_jobs SET status = 'failed', error = ?, finished_at = ? WHERE status = 'running'`).run(error, now);
  }

  purgeBefore(ts: number) {
    this.db.prepare('DELETE FROM ai_jobs WHERE created_at < ?').run(ts);
  }
}
