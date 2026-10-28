import type { SessionResult } from '@ict/contracts';
import { EMPTY_SETTINGS, type DeviceSettings, type ServerTarget } from '../core/settings';

export type Role = NonNullable<DeviceSettings['role']>;

export interface AppState {
  loaded: boolean;
  settings: DeviceSettings;
  session: SessionResult | null;
}

export type Action =
  | { type: 'loaded'; settings: DeviceSettings }
  | { type: 'role'; role: Role }
  | { type: 'server'; server: ServerTarget }
  | { type: 'device'; device: NonNullable<DeviceSettings['device']> }
  | { type: 'session'; session: SessionResult | null }
  | { type: 'reset' };

export const initialState: AppState = { loaded: false, settings: EMPTY_SETTINGS, session: null };

export function reducer(state: AppState, a: Action): AppState {
  switch (a.type) {
    case 'loaded':
      return { ...state, loaded: true, settings: a.settings };
    case 'role':
      return { ...state, settings: { ...EMPTY_SETTINGS, role: a.role } };
    case 'server':
      return { ...state, settings: { ...state.settings, server: a.server } };
    case 'device':
      return { ...state, settings: { ...state.settings, device: a.device } };
    case 'session':
      return { ...state, session: a.session };
    case 'reset':
      return { ...initialState, loaded: true };
  }
}

export type Phase = 'loading' | 'pick-role' | 'find-server' | 'enrol' | 'sign-in' | 'home';

// The screen to show is worked out from what we know, never stored separately.
export function phaseOf(s: AppState): Phase {
  if (!s.loaded) return 'loading';
  if (!s.settings.role) return 'pick-role';
  if (!s.settings.server) return 'find-server';
  if (s.settings.role !== 'console' && !s.settings.device) return 'enrol';
  if (!s.session) return 'sign-in';
  return 'home';
}
