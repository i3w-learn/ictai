import type { FastifyInstance } from 'fastify';
import { asStudent, route } from '../../core/route.js';
import type { NoteService } from './note.service.js';

export function noteRoutes(app: FastifyInstance, deps: { notes: NoteService }) {
  const { notes } = deps;

  route(app, 'GET /api/v1/notes', ({ principal }) => notes.list(asStudent(principal)));
  route(app, 'POST /api/v1/notes', ({ body, principal }) => notes.create(asStudent(principal), body));
  route(app, 'PUT /api/v1/notes/:id', ({ params, body, principal }) => notes.replace(asStudent(principal), params.id, body));
  route(app, 'DELETE /api/v1/notes/:id', ({ params, principal }) => notes.remove(asStudent(principal), params.id));
}
