import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { DEVICE_PING_MS, type RouteKey } from '@ict/contracts';
import { ApiCallError, ApiClient, type CallInput, type CallOutput } from '../core/api-client';
import { RelayClient, type RelayStatus } from '../core/relay-client';
import { ServerLocator } from '../core/server-locator';
import { SettingsStore, type ServerTarget } from '../core/settings';
import type { Platform } from '../platform/platform';
import { initialState, phaseOf, reducer, type Action, type AppState, type Role } from './app-state';

// Which token a call carries: the signed-in person's, this device's, or none.
export type Credential = 'session' | 'device' | 'none';

interface AppContextValue {
  state: AppState;
  phase: ReturnType<typeof phaseOf>;
  dispatch: (a: Action) => void;
  platform: Platform;
  locator: ServerLocator | null;
  relay: RelayClient;
  call: <K extends RouteKey>(key: K, input?: CallInput<K>, credential?: Credential) => Promise<CallOutput<K>>;
  signOut: () => Promise<void>;
  resetDevice: () => Promise<void>;
}

const Ctx = createContext<AppContextValue | null>(null);

export function AppProvider({ platform, children }: { platform: Platform; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const store = useMemo(() => new SettingsStore(platform), [platform]);

  // The API client reads the latest server address through a ref, so it never goes stale.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    void (async () => {
      const settings = await store.load();
      // A role picked in the installer skips the "What is this device?" screen.
      const role = settings.role ?? (await platform.installRole().catch(() => null));
      dispatch({ type: 'loaded', settings: { ...settings, role } });
    })();
  }, [store, platform]);

  useEffect(() => {
    if (state.loaded) void store.save(state.settings);
  }, [store, state.loaded, state.settings]);

  const role: Role | null = state.settings.role;
  const locator = useMemo(() => (role ? new ServerLocator(platform, role) : null), [platform, role]);
  const api = useMemo(
    () =>
      locator &&
      new ApiClient(platform, locator, {
        get: () => stateRef.current.settings.server,
        set: (server: ServerTarget) => dispatch({ type: 'server', server }),
      }),
    [platform, locator],
  );

  // One live socket while someone is signed in (spec 8.3).
  const relay = useMemo(
    () => new RelayClient(platform, () => stateRef.current.settings.server, () => dispatch({ type: 'session', session: null })),
    [platform],
  );
  useEffect(() => {
    relay.attach();
    return () => relay.detach();
  }, [relay]);
  const sessionToken = state.session?.token ?? null;
  useEffect(() => {
    if (sessionToken) relay.connect(sessionToken);
    else relay.disconnect();
  }, [relay, sessionToken]);

  // A lab PC or board tells the server "I am here" every few seconds, signed in or not, so the
  // console can show which PCs are connected.
  const deviceToken = state.settings.device?.token ?? null;
  useEffect(() => {
    if (!api || !deviceToken) return;
    const ping = () => void api.call('POST /api/v1/devices/ping', {}, deviceToken).catch(() => undefined);
    ping();
    const t = setInterval(ping, DEVICE_PING_MS);
    return () => clearInterval(t);
  }, [api, deviceToken]);

  // Who is signed in can change while the app is open: the Super Admin may edit a teacher's
  // classes, subjects or permissions. Re-read it after any refusal and once a minute, so the
  // screens follow the server rather than the copy taken at sign-in.
  const refreshMe = useCallback(async () => {
    const s = stateRef.current.session;
    if (!s || !api) return;
    try {
      const principal = await api.call('GET /api/v1/auth/me', {}, s.token);
      if (stateRef.current.session?.token === s.token) dispatch({ type: 'session', session: { ...s, principal } });
    } catch {
      // A dead session is handled by the next ordinary call.
    }
  }, [api]);
  useEffect(() => {
    if (!sessionToken) return;
    const t = setInterval(() => void refreshMe(), 60_000);
    return () => clearInterval(t);
  }, [sessionToken, refreshMe]);

  const value = useMemo<AppContextValue>(() => {
    const call: AppContextValue['call'] = async (key, input, credential = 'session') => {
      if (!api) throw new ApiCallError(0, 'NO_SERVER', 'Choose this device’s role first.');
      const s = stateRef.current;
      const token = credential === 'session' ? s.session?.token : credential === 'device' ? s.settings.device?.token : undefined;
      try {
        return await api.call(key, input, token);
      } catch (e) {
        // An expired session sends the person back to sign-in.
        if (e instanceof ApiCallError && e.status === 401 && credential === 'session') dispatch({ type: 'session', session: null });
        // A refusal may mean our picture of this person is stale; fetch a fresh one.
        if (e instanceof ApiCallError && e.status === 403 && credential === 'session') void refreshMe();
        throw e;
      }
    };
    return {
      state,
      phase: phaseOf(state),
      dispatch,
      platform,
      locator,
      relay,
      call,
      signOut: async () => {
        await call('POST /api/v1/auth/logout', {}).catch(() => undefined);
        dispatch({ type: 'session', session: null });
      },
      resetDevice: async () => {
        await store.clear();
        dispatch({ type: 'reset' });
      },
    };
  }, [state, platform, locator, relay, api, store, refreshMe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

// The latest state the server pushed for a room, or null until the first one arrives.
// `error` is the server's message when we may not, or may no longer, see the room.
export function useRelayRoom<T>(room: string | null): { state: T | null; error: string | null } {
  const { relay } = useApp();
  const [state, setState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setState(null);
    setError(null);
    if (!room) return;
    return relay.subscribe(room, (s) => { setState(s as T); setError(null); }, setError);
  }, [relay, room]);
  return { state, error };
}

export function useRelayStatus(): RelayStatus {
  const { relay } = useApp();
  const [status, setStatus] = useState(relay.getStatus());
  useEffect(() => {
    setStatus(relay.getStatus());
    return relay.onStatus(setStatus);
  }, [relay]);
  return status;
}

// A room's state that stays fresh even when the relay is down: relay pushes and REST replies
// both update it (whichever came last wins), and while offline it re-reads every 3 s.
export function useLiveState<T>(room: string, initial: T | null, read: () => Promise<T>) {
  const live = useRelayRoom<T>(room);
  const status = useRelayStatus();
  const [state, setState] = useState<T | null>(initial);
  useEffect(() => { if (live.state) setState(live.state); }, [live.state]);
  useEffect(() => {
    if (status === 'online') return;
    const t = setInterval(() => void read().then(setState).catch(() => undefined), 3000);
    return () => clearInterval(t);
  }, [status, room]);
  return [state, setState, live.error] as const;
}
