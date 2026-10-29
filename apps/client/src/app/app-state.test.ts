import { describe, expect, it } from 'vitest';
import { initialState, phaseOf, reducer } from './app-state';

const server = { serverId: 's1', name: 'Lab', certFp: 'AA', addr: '10.0.0.2', port: 7700 };
const device = { deviceId: 'd1', token: 't', name: 'LAB-PC-1' };

describe('app state', () => {
  it('walks through setup in order', () => {
    let s = reducer(initialState, { type: 'loaded', settings: { role: null, server: null, device: null } });
    expect(phaseOf(s)).toBe('pick-role');
    s = reducer(s, { type: 'role', role: 'student' });
    expect(phaseOf(s)).toBe('find-server');
    s = reducer(s, { type: 'server', server });
    expect(phaseOf(s)).toBe('enrol');
    s = reducer(s, { type: 'device', device });
    expect(phaseOf(s)).toBe('sign-in');
  });

  it('a console skips enrolment', () => {
    let s = reducer(initialState, { type: 'loaded', settings: { role: 'console', server, device: null } });
    expect(phaseOf(s)).toBe('sign-in');
  });

  it('changing server keeps the role but forgets the old server and enrolment', () => {
    let s = reducer(initialState, { type: 'loaded', settings: { role: 'student', server, device } });
    s = reducer(s, { type: 'forget-server' });
    expect(s.settings).toEqual({ role: 'student', server: null, device: null });
    expect(phaseOf(s)).toBe('find-server');
  });
});
