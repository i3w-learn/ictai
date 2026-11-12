import { z } from 'zod';

export const DeviceKind = z.enum(['lab_pc', 'board']);
export type DeviceKind = z.infer<typeof DeviceKind>;

// New PCs and boards join the lab by themselves: nobody types or presses anything. Staff can lock the lab
// once every PC is in, so that no further device can join.
export const Joining = z.object({ open: z.boolean() });
export type Joining = z.infer<typeof Joining>;

export const DeviceEnrol = z.object({
  // The PC does not choose its own name: the server names it "Lab PC 7" or "Board 2", so a PC cannot
  // pass itself off as another one in the staff's list.
  kind: DeviceKind,
  appVersion: z.string().max(32),
});
export type DeviceEnrol = z.infer<typeof DeviceEnrol>;

export const DeviceEnrolResult = z.object({
  deviceId: z.string(),
  name: z.string(),
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
  // The app on this PC spoke to the server in the last 45 seconds.
  connected: z.boolean(),
  // The student signed in on this PC right now. The name is null for a teacher who does not teach that class.
  student: z.object({ name: z.string().nullable(), className: z.string() }).nullable(),
});

// Each lab PC and board tells the server "I am here" this often, signed in or not.
export const DEVICE_PING_MS = 15_000;
// Three missed pings and the PC shows as not connected.
export const CONNECTED_WITHIN_MS = 45_000;
export type Device = z.infer<typeof Device>;
