import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import { RELAY_MAX_BYTES, RELAY_PATH } from '@ict/contracts';
import { bearerToken } from '../modules/auth/auth.routes.js';
import { hashToken } from '../modules/auth/secrets.js';
import type { PrincipalResolver } from '../modules/auth/principal.resolver.js';
import type { Relay } from './relay.js';

// Spec 8.3: wss://<server>:7700/relay, signed in by the Authorization header on the upgrade.
export function relayRoutes(app: FastifyInstance, deps: { relay: Relay; resolver: PrincipalResolver }) {
  app.register(websocket, { options: { maxPayload: RELAY_MAX_BYTES } });
  app.register(async (scope) => {
    scope.get(RELAY_PATH, { websocket: true }, (socket, req) => {
      if (!req.principal) {
        socket.close(4401, 'Sign in first.');
        return;
      }
      // Only the token's hash stays with the socket, never the token itself.
      const hash = hashToken(bearerToken(req)!);
      const handlers = deps.relay.attach(
        { send: (text) => socket.readyState === socket.OPEN && socket.send(text), close: (code, reason) => socket.close(code, reason) },
        () => deps.resolver.peek(hash),
      );
      socket.on('message', (data) => handlers.message(data.toString()));
      socket.on('close', handlers.close);
      socket.on('error', handlers.close);
    });
  });
}
