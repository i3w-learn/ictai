import { z } from 'zod';
import type { Platform } from '../platform/platform';

// What a device remembers between restarts. Spec 2.5: the server's ID, not its IP.
export const ServerTarget = z.object({
  serverId: z.string(),
  name: z.string(),
  certFp: z.string(),
  addr: z.string(),
  port: z.number(),
});
export type ServerTarget = z.infer<typeof ServerTarget>;

export const DeviceSettings = z.object({
  role: z.enum(['console', 'student', 'board']).nullable(),
  server: ServerTarget.nullable(),
  device: z.object({ deviceId: z.string(), token: z.string(), name: z.string() }).nullable(),
});
export type DeviceSettings = z.infer<typeof DeviceSettings>;

export const EMPTY_SETTINGS: DeviceSettings = { role: null, server: null, device: null };

export const baseUrl = (t: Pick<ServerTarget, 'addr' | 'port'>) => `https://${t.addr}:${t.port}`;

export class SettingsStore {
  constructor(private readonly platform: Platform) {}

  async load(): Promise<DeviceSettings> {
    const raw = await this.platform.loadSettings();
    const parsed = DeviceSettings.safeParse(raw);
    return parsed.success ? parsed.data : EMPTY_SETTINGS;
  }

  save(s: DeviceSettings): Promise<void> {
    return this.platform.saveSettings(s);
  }

  clear(): Promise<void> {
    return this.platform.clearSettings();
  }
}
