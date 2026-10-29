import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { PlatformError, type AppKind, type FoundServer, type Platform, type RawRequest, type RawResponse, type RelayEvent } from './platform';

// Rust commands reject with { kind, message }; turn that into a PlatformError.
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    const err = e as { kind?: PlatformError['kind']; message?: string };
    throw new PlatformError(err.kind ?? 'internal', err.message ?? String(e));
  }
}

export class TauriPlatform implements Platform {
  constructor(readonly appVersion: string) {}

  discover(app: AppKind) {
    return call<FoundServer[]>('discover_servers', { app, version: this.appVersion });
  }

  request(request: RawRequest) {
    return call<RawResponse>('api_request', { request });
  }

  probe(baseUrl: string) {
    return call<{ certFp: string; health: unknown }>('probe_server', { baseUrl });
  }

  loadSettings() {
    return call<unknown | null>('load_settings');
  }

  saveSettings(settings: unknown) {
    return call<void>('save_settings', { settings });
  }

  clearSettings() {
    return call<void>('clear_settings');
  }

  relayOpen(baseUrl: string, certFp: string, token: string) {
    return call<number>('relay_open', { baseUrl, certFp, token });
  }

  relaySend(text: string) {
    return call<void>('relay_send', { text });
  }

  relayClose() {
    return call<void>('relay_close');
  }

  onRelay(listener: (e: RelayEvent) => void) {
    const stops = [
      listen<{ conn: number; text: string }>('relay://message', (e) => listener({ kind: 'message', ...e.payload })),
      listen<{ conn: number; code: number | null; reason: string }>('relay://closed', (e) => listener({ kind: 'closed', ...e.payload })),
    ];
    return () => stops.forEach((p) => void p.then((stop) => stop()));
  }

  installRole() {
    return call<AppKind | null>('install_role');
  }
}
