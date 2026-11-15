import type { FastifyInstance } from 'fastify';
import { FileChunkParams } from '@ict/contracts';
import { unauthenticated } from '../../core/errors.js';
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

  // The file as raw bytes, for the app's own players. It is not in the contract table because it does
  // not answer with JSON: the body is the file itself, or the part of it the Range header asks for.
  app.get('/api/v1/files/:hash/raw', async (req, reply) => {
    if (!req.principal) throw unauthenticated();
    const { hash } = FileChunkParams.pick({ hash: true }).parse(req.params);
    const f = content.fileStream(req.principal, hash, req.headers.range);
    reply.header('accept-ranges', 'bytes').header('x-content-type-options', 'nosniff').header('cache-control', 'private, no-store');
    if (f.status === 416) return reply.status(416).header('content-range', `bytes */${f.size}`).send();
    reply.status(f.status).type(f.mime).header('content-length', f.end - f.start + 1);
    if (f.status === 206) reply.header('content-range', `bytes ${f.start}-${f.end}/${f.size}`);
    return reply.send(f.body ?? '');
  });
}
