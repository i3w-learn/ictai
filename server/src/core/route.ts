import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { z, ZodType } from 'zod';
import { API, type Access, type Endpoint, type Principal, type RouteKey } from '@ict/contracts';
import { forbidden, unauthenticated } from './errors.js';

type Infer<T> = T extends ZodType ? z.output<T> : undefined;
type Ep<K extends RouteKey> = (typeof API)[K];
type Field<K extends RouteKey, F extends string> = Ep<K> extends Record<F, infer S> ? S : undefined;

export interface RouteInput<K extends RouteKey> {
  body: Infer<Field<K, 'body'>>;
  query: Infer<Field<K, 'query'>>;
  params: Infer<Field<K, 'params'>>;
  principal: Principal | null;
  req: FastifyRequest;
}

type Output<K extends RouteKey> = Field<K, 'response'> extends ZodType ? z.input<Field<K, 'response'>> : void;

// Registers a route straight from the contract table: the contract decides the URL,
// who may call it, how input is checked and the success status. Handlers hold only the logic.
export function route<K extends RouteKey>(
  app: FastifyInstance,
  key: K,
  handler: (input: RouteInput<K>) => Promise<Output<K>> | Output<K>,
) {
  const [method, url] = key.split(' ') as [string, string];
  const ep: Endpoint = API[key];
  app.route({
    method: method as 'GET',
    url,
    handler: async (req, reply) => {
      checkAccess(ep.access, req.principal);
      const input = {
        body: ep.body ? ep.body.parse(req.body ?? {}) : undefined,
        query: ep.query ? ep.query.parse(req.query) : undefined,
        params: ep.params ? ep.params.parse(req.params) : undefined,
        principal: req.principal,
        req,
      } as RouteInput<K>;
      const out = await handler(input);
      reply.status(ep.status);
      return ep.response ? out : reply.send();
    },
  });
}

export function checkAccess(access: Access, p: Principal | null) {
  if (access.kind === 'public') return;
  if (!p) throw unauthenticated();
  switch (access.kind) {
    case 'signed-in':
      return;
    case 'staff':
      if (p.kind !== 'staff') throw forbidden('Staff only.');
      if (access.permission && !p.permissions.includes(access.permission)) {
        throw forbidden(`Missing permission ${access.permission}.`);
      }
      return;
    case 'device':
      if (p.kind !== 'device') throw forbidden('Only an enrolled device can do this.');
      if (access.deviceKind && p.deviceKind !== access.deviceKind) throw forbidden(`Only a ${access.deviceKind} can do this.`);
      return;
  }
}

// Narrowing helpers for handlers whose contract already guaranteed the principal kind.
export function asStaff(p: Principal | null) {
  if (p?.kind !== 'staff') throw forbidden('Staff only.');
  return p;
}
export function asDevice(p: Principal | null) {
  if (p?.kind !== 'device') throw forbidden('Device only.');
  return p;
}
