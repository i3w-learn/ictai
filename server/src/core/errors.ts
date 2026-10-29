import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Sign in first.');
export const forbidden = (why: string) => new AppError(403, 'FORBIDDEN', why);
export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`);
export const lockedOut = (waitMs: number) =>
  new AppError(429, 'LOCKED_OUT', `Too many wrong tries. Try again in ${Math.ceil(waitMs / 60_000)} min.`);

// Turns a UNIQUE constraint clash into 409 ALREADY_EXISTS.
export function unique<T>(insert: () => T, message: string): T {
  try {
    return insert();
  } catch (err) {
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError(409, 'ALREADY_EXISTS', message);
    throw err;
  }
}

// Every error leaves the server as { code, message } (spec 14).
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ code: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const where = first?.path.join('.') || 'body';
      return reply.status(400).send({ code: 'BAD_REQUEST', message: `${where}: ${first?.message ?? 'invalid'}` });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ code: 'BAD_REQUEST', message: (err as Error).message });
    }
    req.log.error(err);
    return reply.status(500).send({ code: 'INTERNAL', message: 'Something went wrong on the server.' });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ code: 'NOT_FOUND', message: `No route for ${req.method} ${req.url}` }),
  );
}
