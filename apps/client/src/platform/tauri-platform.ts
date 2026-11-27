import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { PlatformError, type AppKind, type BoardWindow, type FoundServer, type Platform, type RawRequest, type RawResponse, type RelayEvent } from './platform';

// Rust commands reject with { kind, message }; turn that into a PlatformError.
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    const err = e as { kind?: PlatformError['kind']; message?: string };
    throw new PlatformError(err.kind ?? 'internal', err.message ?? String(e));
  }
}

// The console and the board window talk over the app's own events. Both windows hear every event,
// their own too, so each message says which window it is from.
const TALK = 'present://say';
const stopAll = (stops: Promise<() => void>[]) => () => stops.forEach((p) => void p.then((stop) => stop()));

function boardWindow(isBoard: boolean): BoardWindow {
  return {
    isBoard,
    open: () => call<void>('present_open'),
    close: () => call<void>('present_close'),
    say: (message) => emit(TALK, { fromBoard: isBoard, message }),
    hear: (listener) => stopAll([listen<{ fromBoard: boolean; message: unknown }>(TALK, (e) => { if (e.payload.fromBoard !== isBoard) listener(e.payload.message); })]),
    onClosed: (listener) => stopAll([listen('present://closed', () => listener())]),
  };
}

export class TauriPlatform implements Platform {
  readonly present: BoardWindow;

  // The board window is opened on the same page as the console, with `#present` at the end.
  constructor(readonly appVersion: string, isBoard = false) {
    this.present = boardWindow(isBoard);
  }

  discover(app: AppKind) {
    return call<FoundServer[]>('discover_servers', { app, version: this.appVersion });
  }

  request(request: RawRequest) {
    return call<RawResponse>('api_request', { request });
  }

  keepAlive(request: RawRequest | null, everyMs?: number) {
    return call<void>('keep_alive', { request, everyMs });
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
    return stopAll(stops);
  }

  setFileSource(source: { baseUrl: string; certFp: string; token: string } | null) {
    return call<void>('set_file_source', source ?? {});
  }

  // ictfile://localhost/<hash> on macOS and Linux, http://ictfile.localhost/<hash> on Windows.
  fileUrl(hash: string) {
    return convertFileSrc(hash, 'ictfile');
  }

  lockDown(on: boolean) {
    return call<void>('lock_down', { on });
  }

  installRole() {
    return call<AppKind | null>('install_role');
  }
}
