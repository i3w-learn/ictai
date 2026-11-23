import { describe, expect, it } from 'vitest';
import { isBlockedKey, lockDown, type LockTarget } from './lockdown';

const press = (key: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) =>
  ({ key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift });

describe('keys a student PC does not act on', () => {
  it('blocks print, save, open, page source, downloads, history, new window and reload', () => {
    for (const key of ['p', 's', 'o', 'u', 'j', 'h', 'n', 'r']) {
      expect(isBlockedKey(press(key, { ctrl: true })), `Ctrl+${key}`).toBe(true);
      expect(isBlockedKey(press(key.toUpperCase(), { ctrl: true, shift: true })), `Ctrl+Shift+${key}`).toBe(true);
      expect(isBlockedKey(press(key, { meta: true })), `Cmd+${key}`).toBe(true);
    }
  });

  it('blocks the developer tools and reload keys', () => {
    expect(isBlockedKey(press('F12'))).toBe(true);
    expect(isBlockedKey(press('F5'))).toBe(true);
    expect(isBlockedKey(press('I', { ctrl: true, shift: true }))).toBe(true);
    expect(isBlockedKey(press('C', { ctrl: true, shift: true }))).toBe(true);
  });

  it('leaves typing, copy, paste, undo and zoom alone', () => {
    for (const key of ['p', 's', 'a', 'Enter', ' ', 'Tab', 'Backspace', 'ArrowLeft', 'F1']) expect(isBlockedKey(press(key)), key).toBe(false);
    for (const key of ['c', 'v', 'x', 'a', 'z', '+', '-', '0']) expect(isBlockedKey(press(key, { ctrl: true })), `Ctrl+${key}`).toBe(false);
    expect(isBlockedKey(press('i', { ctrl: true }))).toBe(false);
  });
});

// A stand-in for the window: remembers its listeners so a test can fire an event at them.
function fakeWindow() {
  const listeners = new Map<string, Set<(e: never) => void>>();
  const calls = { print: 0, open: 0 };
  const win: LockTarget = {
    addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn as never); },
    removeEventListener: (type, fn) => { listeners.get(type)?.delete(fn as never); },
    print: () => { calls.print += 1; },
    open: () => { calls.open += 1; return {}; },
  };
  const attrs = new Set<string>();
  const root = { setAttribute: (n: string) => { attrs.add(n); }, removeAttribute: (n: string) => { attrs.delete(n); } };
  // Fires an event and says whether it was stopped.
  const fire = (type: string, more: object = {}) => {
    let stopped = false;
    const e = { ...more, preventDefault: () => { stopped = true; }, stopPropagation: () => undefined };
    for (const fn of listeners.get(type) ?? []) fn(e as never);
    return stopped;
  };
  return { win, root, attrs, calls, fire };
}

describe('locking a student PC down', () => {
  it('stops right-click, dragging things out, and the blocked keys, but not ordinary typing', () => {
    const { win, root, fire } = fakeWindow();
    lockDown(win, root);
    expect(fire('contextmenu')).toBe(true);
    expect(fire('dragstart')).toBe(true);
    expect(fire('keydown', press('p', { ctrl: true }))).toBe(true);
    expect(fire('keydown', press('F12'))).toBe(true);
    expect(fire('keydown', press('a'))).toBe(false);
    expect(fire('keydown', press('v', { ctrl: true }))).toBe(false);
  });

  it('makes print and "open a new window" do nothing, and marks the page so a print comes out empty', () => {
    const { win, root, attrs, calls } = fakeWindow();
    lockDown(win, root);
    win.print();
    expect(win.open()).toBeNull();
    expect(calls).toEqual({ print: 0, open: 0 });
    expect(attrs.has('data-lockdown')).toBe(true);
  });

  it('puts everything back when switched off', () => {
    const { win, root, attrs, calls, fire } = fakeWindow();
    const off = lockDown(win, root);
    off();
    expect(fire('contextmenu')).toBe(false);
    expect(fire('keydown', press('p', { ctrl: true }))).toBe(false);
    win.print();
    expect(calls.print).toBe(1);
    expect(attrs.has('data-lockdown')).toBe(false);
  });
});
