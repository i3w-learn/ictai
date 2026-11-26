// The native capabilities the app needs. Screens and core logic depend on this
// interface only, so they can be tested with a fake and don't care that Tauri sits underneath.

export type AppKind = 'console' | 'student' | 'board';

export interface FoundServer {
  serverId: string;
  schoolId: string | null;
  name: string;
  addrs: string[];
  port: number;
  certFp: string | null;
  from: string; // the address the reply came from
}

export interface RawRequest {
  baseUrl: string;
  certFp: string;
  method: string;
  path: string;
  body?: unknown;
  token?: string;
  // How long to wait for the answer. Left out, the usual ten seconds.
  timeoutMs?: number;
}

export interface RawResponse {
  status: number;
  body: unknown;
}

// Events from the relay socket. `conn` says which socket; events from a replaced one are stale.
export type RelayEvent =
  | { kind: 'message'; conn: number; text: string }
  | { kind: 'closed'; conn: number; code: number | null; reason: string };

export interface Platform {
  readonly appVersion: string;
  discover(app: AppKind): Promise<FoundServer[]>;
  request(req: RawRequest): Promise<RawResponse>;
  probe(baseUrl: string): Promise<{ certFp: string; health: unknown }>;
  loadSettings(): Promise<unknown | null>;
  saveSettings(settings: unknown): Promise<void>;
  clearSettings(): Promise<void>;
  /** Opens the live relay socket (closing any earlier one); resolves to its number. */
  relayOpen(baseUrl: string, certFp: string, token: string): Promise<number>;
  relaySend(text: string): Promise<void>;
  relayClose(): Promise<void>;
  onRelay(listener: (e: RelayEvent) => void): () => void;
  /**
   * Library files as a stream. `setFileSource` says which server and signed-in person files are fetched
   * for (null = nobody). `fileUrl` is then an address a picture, video or sound player can be pointed at,
   * and that the teacher's PDF reader reads part by part, so a big book opens before it has all arrived.
   * Left out where there is no native side (tests, the browser harness): screens then fetch in pieces.
   */
  setFileSource?(source: { baseUrl: string; certFp: string; token: string } | null): Promise<void>;
  fileUrl?(hash: string): string;
  /**
   * Says `req` again every `everyMs` on the app's own clock, until called again (null stops it) or
   * the server says the thing is gone. For "this teacher is still showing her video": a page's own
   * timers are slowed down when its window is hidden. Left out where there is no native side.
   */
  keepAlive?(req: RawRequest | null, everyMs?: number): Promise<void>;
  /**
   * Tells the native side this is a student PC (or no longer is one): while on, it refuses every
   * download and every new window. Left out where there is no native side.
   */
  lockDown?(on: boolean): Promise<void>;
  /** The role chosen in the Windows installer, if any. */
  installRole(): Promise<AppKind | null>;
}

export type PlatformErrorKind = 'network' | 'pin-mismatch' | 'bad-input' | 'storage' | 'internal';

export class PlatformError extends Error {
  constructor(
    readonly kind: PlatformErrorKind,
    message: string,
  ) {
    super(message);
  }
}
