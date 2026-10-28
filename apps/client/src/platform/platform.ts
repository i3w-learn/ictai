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

export interface Platform {
  readonly appVersion: string;
  discover(app: AppKind): Promise<FoundServer[]>;
  request(req: RawRequest): Promise<RawResponse>;
  probe(baseUrl: string): Promise<{ certFp: string; health: unknown }>;
  loadSettings(): Promise<unknown | null>;
  saveSettings(settings: unknown): Promise<void>;
  clearSettings(): Promise<void>;
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
