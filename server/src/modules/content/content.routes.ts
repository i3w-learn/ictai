import type { FastifyInstance } from 'fastify';
import { asStaff, asStudent, route } from '../../core/route.js';
import type { ContentService } from './content.service.js';

export function contentRoutes(app: FastifyInstance, deps: { content: ContentService }) {
  const { content } = deps;
  route(app, 'GET /api/v1/content', ({ query, principal }) => content.list(asStaff(principal), query.classId));
  route(app, 'GET /api/v1/content/mine', ({ principal }) => content.forStudent(asStudent(principal)));
  route(app, 'POST /api/v1/content/links', ({ body, principal }) => content.addLink(asStaff(principal), body));
  route(app, 'POST /api/v1/content/uploads', ({ body, principal }) => content.startUpload(asStaff(principal), body.fileName, body.size));
  route(app, 'PUT /api/v1/content/uploads/:id/chunks', ({ params, body, principal }) => content.addChunk(asStaff(principal), params.id, body.index, body.data));
  route(app, 'POST /api/v1/content/uploads/:id/finish', ({ params, body, principal }) => content.finishUpload(asStaff(principal), params.id, body));
  route(app, 'DELETE /api/v1/content/:id', ({ params, principal }) => content.remove(asStaff(principal), params.id));
  route(app, 'GET /api/v1/files/:hash/chunks/:index', ({ params, principal }) => content.fileChunk(principal!, params.hash, params.index));
}
