import { z } from 'zod';

// Spec 8.1: UDP broadcast on port 7701.
export const DiscoverMsg = z.object({
  t: z.literal('discover'),
  v: z.literal(1),
  app: z.enum(['student', 'board', 'console', 'remote']),
  ver: z.string(),
});
export type DiscoverMsg = z.infer<typeof DiscoverMsg>;

export const HereMsg = z.object({
  t: z.literal('here'),
  v: z.literal(1),
  serverId: z.string(),
  schoolId: z.string().nullable(),
  name: z.string(),
  addrs: z.array(z.string()),
  port: z.number(),
  certFp: z.string().nullable(),
});
export type HereMsg = z.infer<typeof HereMsg>;
