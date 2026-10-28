import { z } from 'zod';

export const PORTS = { api: 7700, beacon: 7701 } as const;

export const Id = z.string().uuid();

// Every error leaves the server as { code, message } (spec 14).
export const ApiError = z.object({ code: z.string(), message: z.string() });
export type ApiError = z.infer<typeof ApiError>;

export const Health = z.object({
  ok: z.literal(true),
  serverId: z.string(),
  schoolId: z.string().nullable(),
  name: z.string(),
  activated: z.boolean(),
  version: z.string(),
});
export type Health = z.infer<typeof Health>;
