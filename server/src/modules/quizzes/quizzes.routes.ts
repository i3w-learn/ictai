import type { FastifyInstance } from 'fastify';
import { asStaff, asStudent, route } from '../../core/route.js';
import type { QuizService } from './quiz.service.js';
import type { RunService } from './run.service.js';

export function quizRoutes(app: FastifyInstance, deps: { quizzes: QuizService; runs: RunService }) {
  const { quizzes, runs } = deps;

  route(app, 'GET /api/v1/quizzes', ({ query }) => quizzes.list(query.classId));
  route(app, 'POST /api/v1/quizzes', ({ body, principal }) => quizzes.create(asStaff(principal), body));
  route(app, 'GET /api/v1/quizzes/:id', ({ params }) => quizzes.get(params.id));
  route(app, 'PUT /api/v1/quizzes/:id', ({ params, body }) => quizzes.replace(params.id, body));
  route(app, 'DELETE /api/v1/quizzes/:id', ({ params }) => quizzes.remove(params.id));

  // Lab Mode
  route(app, 'POST /api/v1/quiz-runs', ({ body, principal }) => runs.open(asStaff(principal), body.quizId));
  route(app, 'GET /api/v1/quiz-runs', ({ query }) => runs.list(query.quizId));
  route(app, 'GET /api/v1/quiz-runs/:id', ({ params }) => runs.teacherState(params.id));
  route(app, 'POST /api/v1/quiz-runs/:id/start', ({ params, principal }) => runs.start(asStaff(principal), params.id));
  route(app, 'POST /api/v1/quiz-runs/:id/end', ({ params, principal }) => runs.end(asStaff(principal), params.id));
  route(app, 'POST /api/v1/quiz-runs/join', ({ body, principal }) => runs.join(asStudent(principal), body.code));
  route(app, 'GET /api/v1/quiz-runs/:id/play', ({ params, principal }) => runs.play(asStudent(principal), params.id));
  route(app, 'POST /api/v1/quiz-runs/:id/answers', ({ params, body, principal }) =>
    runs.answer(asStudent(principal), params.id, body.questionIndex, body.choice));
  route(app, 'POST /api/v1/quiz-runs/:id/finish', ({ params, principal }) => runs.finish(asStudent(principal), params.id));
}
