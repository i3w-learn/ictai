import { z } from 'zod';

// Spec 8.3: one WebSocket per device at /relay. Every server message uses this envelope.
// seq = server order per room; ts = server clock; id = the client message it answers.
export const RelayEnvelope = z.object({
  t: z.string(),
  room: z.string().optional(),
  seq: z.number().optional(),
  ts: z.number(),
  id: z.string().optional(),
  p: z.unknown().optional(),
});
export type RelayEnvelope = z.infer<typeof RelayEnvelope>;

const Room = z.string().min(1).max(128);

// What a client may send. Writes go over REST; the relay only pushes state.
export const ClientMsg = z.discriminatedUnion('t', [
  z.object({ t: z.literal('join'), room: Room, id: z.string().max(64).optional() }),
  z.object({ t: z.literal('leave'), room: Room, id: z.string().max(64).optional() }),
  z.object({ t: z.literal('ping'), id: z.string().max(64).optional() }),
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

export const RELAY_PATH = '/relay';
export const RELAY_MAX_BYTES = 64 * 1024;
