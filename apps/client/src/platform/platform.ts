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
