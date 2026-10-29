import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import { RELAY_MAX_BYTES, RELAY_PATH } from '@ict/contracts';
import type { Relay } from './relay.js';

// Spec 8.3: wss://<server>:7700/relay, signed in by the Authorization header on the upgrade.
export function relayRoutes(app: FastifyInstance, deps: { relay: Relay }) {
  app.register(websocket, { options: { maxPayload: RELAY_MAX_BYTES } });
  app.register(async (scope) => {
    scope.get(RELAY_PATH, { websocket: true }, (socket, req) => {
      if (!req.principal) {
        socket.close(4401, 'Sign in first.');
        return;
      }
      const handlers = deps.relay.attach(
        { send: (text) => socket.readyState === socket.OPEN && socket.send(text), close: (code, reason) => socket.close(code, reason) },
        req.principal,
      );
      socket.on('message', (data) => handlers.message(data.toString()));
      socket.on('close', handlers.close);
      socket.on('error', handlers.close);
    });
  });
}
