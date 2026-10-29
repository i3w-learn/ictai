import type { z, ZodType } from 'zod';
import { API, ApiError, type Endpoint, type RouteKey } from '@ict/contracts';
import { PlatformError, type Platform } from '../platform/platform';
import type { ServerLocator } from './server-locator';
import { baseUrl, type ServerTarget } from './settings';

type Ep<K extends RouteKey> = (typeof API)[K];
type Field<K extends RouteKey, F extends string> = Ep<K> extends Record<F, infer S> ? S : undefined;
type In<T> = T extends ZodType ? z.input<T> : never;

export type CallInput<K extends RouteKey> = {
  [F in 'body' | 'query' | 'params' as Field<K, F> extends ZodType ? F : never]: In<Field<K, F>>;
};
export type CallOutput<K extends RouteKey> = Field<K, 'response'> extends ZodType ? z.output<Field<K, 'response'>> : void;

// A failed call the user can be told about: the server's { code, message }.
export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface TargetStore {
  get(): ServerTarget | null;
  set(t: ServerTarget): void;
}

// Typed client for the school server, built from the shared contract table.
// If the saved address stops answering, it finds the server again by its ID and retries once.
export class ApiClient {
  constructor(
    private readonly platform: Platform,
    private readonly locator: ServerLocator,
    private readonly target: TargetStore,
  ) {}

  async call<K extends RouteKey>(key: K, input = {} as CallInput<K>, token?: string): Promise<CallOutput<K>> {
    const ep: Endpoint = API[key];
    const [method, pattern] = key.split(' ') as [string, string];
    const { body, query, params } = input as { body?: unknown; query?: Record<string, string>; params?: Record<string, string> };
    const path = buildPath(pattern, params, query);

    const res = await this.send({ method, path, body: ep.body ? ep.body.parse(body ?? {}) : undefined, token });
    if (res.status >= 400) {
      const err = ApiError.safeParse(res.body);
      throw new ApiCallError(res.status, err.success ? err.data.code : 'UNKNOWN', err.success ? err.data.message : `Server error ${res.status}`);
    }
    return (ep.response ? ep.response.parse(res.body) : undefined) as CallOutput<K>;
  }

  private async send(r: { method: string; path: string; body?: unknown; token?: string }) {
    const target = this.target.get();
    if (!target) throw new ApiCallError(0, 'NO_SERVER', 'This device is not connected to a server yet.');
    try {
      return await this.platform.request({ ...r, baseUrl: baseUrl(target), certFp: target.certFp });
    } catch (e) {
      if (!(e instanceof PlatformError) || e.kind !== 'network') throw e;
      const moved = await this.locator.relocate(target);
      if (!moved) throw new ApiCallError(0, 'SERVER_UNREACHABLE', 'Cannot reach the school server. Check the network cable or Wi-Fi. If the server PC was reinstalled, click Change server.');
      this.target.set(moved);
      return this.platform.request({ ...r, baseUrl: baseUrl(moved), certFp: moved.certFp });
    }
  }
}

export function buildPath(pattern: string, params?: Record<string, string>, query?: Record<string, string>): string {
  const path = pattern.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params?.[name] ?? ''));
  const qs = query ? new URLSearchParams(query).toString() : '';
  return qs ? `${path}?${qs}` : path;
}
