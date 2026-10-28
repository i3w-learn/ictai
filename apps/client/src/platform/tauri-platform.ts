import { invoke } from '@tauri-apps/api/core';
import { PlatformError, type AppKind, type FoundServer, type Platform, type RawRequest, type RawResponse } from './platform';

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

  installRole() {
    return call<AppKind | null>('install_role');
  }
}
