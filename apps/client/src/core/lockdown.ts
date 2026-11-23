// Spec 6 "Locked-down shell": on a student PC the app offers no way to print, save or download what
// is on the screen, to look at the page's own code, or to open a second window.
// The page lives in a browser engine (WebView2 on Windows), which has all of those built in. This
// switches them off from inside the page. The native side also refuses downloads and new windows
// (see `lock_down` in src-tauri/src/lib.rs), for anything that gets past here.

export interface KeyPress { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }

// With Ctrl (or the Mac's Cmd): print, save, open a file, page source, downloads, history, new window, reload.
const WITH_CTRL = new Set(['p', 's', 'o', 'u', 'j', 'h', 'n', 'r']);
// With Ctrl + Shift: the developer tools, and "clear browsing data".
const WITH_CTRL_SHIFT = new Set(['i', 'c', 'delete']);
// On their own: developer tools, reload, caret browsing.
const ALONE = new Set(['f12', 'f5', 'f7']);

// Is this a key the browser engine would act on in a way a student PC must not allow?
// Ordinary typing, copy and paste (Ctrl+C, Ctrl+V) and zoom are left alone.
export function isBlockedKey(e: KeyPress): boolean {
  const key = e.key.toLowerCase();
  if (ALONE.has(key)) return true;
  if (!e.ctrlKey && !e.metaKey) return false;
  return WITH_CTRL.has(key) || (e.shiftKey && WITH_CTRL_SHIFT.has(key));
}

interface Stoppable { preventDefault(): void; stopPropagation(): void }
type Handler = (e: Stoppable & Partial<KeyPress> & { target?: unknown }) => void;
// The few parts of `window` and `document` this needs, so a test can hand in stand-ins.
export interface LockTarget {
  addEventListener(type: string, fn: Handler, capture: boolean): void;
  removeEventListener(type: string, fn: Handler, capture: boolean): void;
  print: () => void;
  open: (...args: never[]) => unknown;
}
export interface LockRoot { setAttribute(name: string, value: string): void; removeAttribute(name: string): void }

// Switches the browser's own extras off. Returns the way to switch them back on (for sign-out of a
// role, and for React running an effect twice in development).
export function lockDown(win: LockTarget, root: LockRoot): () => void {
  const stop: Handler = (e) => { e.preventDefault(); e.stopPropagation(); };
  // Right-click: the browser's menu has Save as, Print and Inspect.
  const onMenu: Handler = stop;
  const onKey: Handler = (e) => { if (isBlockedKey({ key: e.key ?? '', ctrlKey: !!e.ctrlKey, metaKey: !!e.metaKey, shiftKey: !!e.shiftKey })) stop(e); };
  // Dragging a picture or a link out of the window would save it to the desktop.
  const onDrag: Handler = stop;

  win.addEventListener('contextmenu', onMenu, true);
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('dragstart', onDrag, true);
  const { print, open } = win;
  win.print = () => undefined;
  win.open = () => null;
  // styles.css prints an empty page for a root marked like this, should a print ever start.
  root.setAttribute('data-lockdown', '');

  return () => {
    win.removeEventListener('contextmenu', onMenu, true);
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('dragstart', onDrag, true);
    win.print = print;
    win.open = open;
    root.removeAttribute('data-lockdown');
  };
}
