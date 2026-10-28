import { z } from 'zod';

export const DeviceKind = z.enum(['lab_pc', 'board']);
export type DeviceKind = z.infer<typeof DeviceKind>;

export const OpenEnrolWindow = z.object({
  minutes: z.number().int().min(1).max(30).default(30),
});

export const EnrolWindow = z.object({
  id: z.string(),
  code: z.string().regex(/^\d{6}$/),
  closesAt: z.number(),
});
export type EnrolWindow = z.infer<typeof EnrolWindow>;

export const DeviceEnrol = z.object({
  code: z.string().regex(/^\d{6}$/),
  kind: DeviceKind,
  name: z.string().trim().min(1).max(64),
  appVersion: z.string().max(32),
});
export type DeviceEnrol = z.infer<typeof DeviceEnrol>;

export const DeviceEnrolResult = z.object({
  deviceId: z.string(),
  token: z.string(),
  expiresAt: z.number(),
  serverId: z.string(),
  certFp: z.string().nullable(),
});
export type DeviceEnrolResult = z.infer<typeof DeviceEnrolResult>;

export const Device = z.object({
  id: z.string(),
  kind: DeviceKind,
  name: z.string(),
  status: z.enum(['active', 'retired']),
  appVersion: z.string().nullable(),
  lastSeen: z.number().nullable(),
});
export type Device = z.infer<typeof Device>;
