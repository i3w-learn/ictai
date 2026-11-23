// TEMPORARY browser stand-in for the Tauri shell, used only to try screens by hand. Not shipped.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppProvider } from './app/app-context';
import type { Platform, RelayEvent } from './platform/platform';
import './ui/styles.css';

const profile = new URLSearchParams(location.search).get('p') ?? 'default';
const key = `harness:${profile}`;
const seed = new URLSearchParams(location.search).get('seed');
if (seed) { localStorage.setItem(key, atob(seed)); history.replaceState(null, '', `?p=${profile}`); }

let ws: WebSocket | null = null;
let conn = 0;
const listeners = new Set<(e: RelayEvent) => void>();
const tell = (e: RelayEvent) => listeners.forEach((l) => l(e));

const platform: Platform = {
  appVersion: '0.1.0',
  discover: async () => [],
  request: async (req) => {
    const res = await fetch(req.path, {
      method: req.method,
      headers: { ...(req.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(req.token ? { authorization: `Bearer ${req.token}` } : {}) },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  },
  probe: async () => ({ certFp: (window as { __CERT_FP?: string }).__CERT_FP ?? 'harness', health: await (await fetch('/health')).json() }),
  loadSettings: async () => JSON.parse(localStorage.getItem(key) ?? 'null'),
  saveSettings: async (s) => localStorage.setItem(key, JSON.stringify(s)),
  clearSettings: async () => localStorage.removeItem(key),
  relayOpen: (_base, _fp, token) => new Promise((resolve, reject) => {
    ws?.close();
    const mine = ++conn;
    const sock = new WebSocket(`ws://${location.host}/relay?token=${encodeURIComponent(token)}`);
    ws = sock;
    sock.onopen = () => resolve(mine);
    sock.onerror = () => reject(new Error('relay failed'));
    sock.onmessage = (m) => tell({ kind: 'message', conn: mine, text: String(m.data) });
    sock.onclose = (c) => tell({ kind: 'closed', conn: mine, code: c.code, reason: c.reason });
  }),
  relaySend: async (text) => ws?.send(text),
  relayClose: async () => { ws?.close(); ws = null; },
  onRelay: (l) => { listeners.add(l); return () => listeners.delete(l); },
  installRole: async () => null,
};

createRoot(document.getElementById('root')!).render(<StrictMode><AppProvider platform={platform}><App /></AppProvider></StrictMode>);
