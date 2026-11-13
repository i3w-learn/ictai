import type { FastifyInstance } from 'fastify';
import { asStaff, asStudent, route } from '../../core/route.js';
import type { AiService } from './ai.service.js';

// 202 means "queued, come back for it"; a call that waited and got the finished job answers 200.
const jobStatus = (job: { status: string }) => (job.status === 'done' || job.status === 'failed' ? 200 : 202);

export function aiRoutes(app: FastifyInstance, deps: { ai: AiService }) {
  const { ai } = deps;
  route(app, 'GET /api/v1/ai/status', () => ai.status());
  route(app, 'POST /api/v1/ai/quiz', ({ body, query, principal }) => ai.requestQuiz(asStaff(principal), body, query.wait === '1'), jobStatus);
  route(app, 'POST /api/v1/ai/ask', ({ body, query, principal }) => ai.requestAsk(asStaff(principal), body, query.wait === '1'), jobStatus);
  route(app, 'GET /api/v1/ai/tutor', ({ principal }) => ai.myTutor(asStudent(principal)));
  route(app, 'POST /api/v1/ai/tutor', ({ body, principal }) => ai.requestTutor(asStudent(principal), body));
  route(app, 'GET /api/v1/ai/tutor/:id', ({ params, principal }) => ai.tutorJob(asStudent(principal), params.id));
  route(app, 'GET /api/v1/ai/jobs', ({ principal }) => ai.jobs(asStaff(principal)));
  route(app, 'GET /api/v1/ai/jobs/:id', ({ params, principal }) => ai.job(asStaff(principal), params.id));
}
