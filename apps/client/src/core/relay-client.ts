import { RelayEnvelope } from '@ict/contracts';
import type { Platform, RelayEvent } from '../platform/platform';
import { baseUrl, type ServerTarget } from './settings';

export type RelayStatus = 'off' | 'connecting' | 'online' | 'reconnecting';

// Spec 8.3: reconnect waits 1, 2, 4 … up to 30 s.
export const RECONNECT_DELAYS_S = [1, 2, 4, 8, 16, 30];
// A pulled cable can leave a socket looking open, so we ping and give up if no pong comes back.
const PING_EVERY_MS = 20_000;
const PONG_WITHIN_MS = 10_000;
// The server closes with this code when the token is no longer valid.
const SIGNED_OUT = 4401;

type StateListener = (state: unknown) => void;

// Keeps one live socket to the server, rejoins rooms after a drop, and hands each room's
// latest `state` to whoever subscribed to it. Writes still go over REST.
export class RelayClient {
  private status: RelayStatus = 'off';
  private token: string | null = null;
  private conn: number | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private rooms = new Map<string, Set<StateListener>>();
  private latest = new Map<string, unknown>();
  private statusListeners = new Set<(s: RelayStatus) => void>();
  private stopListening: () => void;

  constructor(
    private readonly platform: Platform,
    private readonly target: () => ServerTarget | null,
    private readonly onSignedOut: () => void = () => {},
  ) {
    this.stopListening = platform.onRelay((e) => this.onEvent(e));
  }

  connect(token: string) {
    if (this.token === token && this.status !== 'off') return;
    this.token = token;
    this.attempt = 0;
    void this.open();
  }

  disconnect() {
    this.token = null;
    this.drop();
    void this.platform.relayClose().catch(() => undefined);
    this.setStatus('off');
  }

  dispose() {
    this.disconnect();
    this.stopListening();
  }

  getStatus() {
    return this.status;
  }

  onStatus(fn: (s: RelayStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  // Joins the room on the first subscriber and leaves it after the last one goes.
  subscribe(room: string, fn: StateListener): () => void {
    let listeners = this.rooms.get(room);
    if (!listeners) {
      listeners = new Set();
      this.rooms.set(room, listeners);
      if (this.status === 'online') this.sendMsg({ t: 'join', room });
    } else if (this.latest.has(room)) {
      fn(this.latest.get(room));
    }
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
      if (listeners.size === 0) {
        this.rooms.delete(room);
        this.latest.delete(room);
        if (this.status === 'online') this.sendMsg({ t: 'leave', room });
      }
    };
  }

  private async open() {
    this.drop();
    const token = this.token;
    const target = this.target();
    if (!token) return;
    if (!target) return this.retry();
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    try {
      const conn = await this.platform.relayOpen(baseUrl(target), target.certFp, token);
      if (this.token !== token) return; // signed out or switched while connecting
      this.conn = conn;
      this.attempt = 0;
      this.setStatus('online');
      for (const room of this.rooms.keys()) this.sendMsg({ t: 'join', room });
      this.pingTimer = setInterval(() => this.ping(), PING_EVERY_MS);
    } catch {
      this.retry();
    }
  }

  private retry() {
    if (!this.token) return;
    this.drop();
    this.setStatus('reconnecting');
    const delay = RECONNECT_DELAYS_S[Math.min(this.attempt, RECONNECT_DELAYS_S.length - 1)]!;
    this.attempt += 1;
    this.retryTimer = setTimeout(() => void this.open(), delay * 1000);
  }

  private ping() {
    this.sendMsg({ t: 'ping' });
    if (this.pongTimer) return;
    this.pongTimer = setTimeout(() => {
      void this.platform.relayClose().catch(() => undefined);
      this.retry();
    }, PONG_WITHIN_MS);
  }

  private onEvent(e: RelayEvent) {
    if (e.conn !== this.conn) return; // from a socket we already replaced
    if (e.kind === 'closed') {
      if (e.code === SIGNED_OUT) {
        this.disconnect();
        this.onSignedOut();
        return;
      }
      this.retry();
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(e.text);
    } catch {
      return;
    }
    const msg = RelayEnvelope.safeParse(raw);
    if (!msg.success) return;
    const { t, room, p } = msg.data;
    if (t === 'pong' && this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
    if (t === 'state' && room && this.rooms.has(room)) {
      this.latest.set(room, p);
      for (const fn of this.rooms.get(room)!) fn(p);
    }
  }

  private sendMsg(m: { t: string; room?: string }) {
    void this.platform.relaySend(JSON.stringify(m)).catch(() => undefined);
  }

  // Forgets the current socket and timers; events from it are ignored from now on.
  private drop() {
    this.conn = null;
    for (const t of [this.retryTimer, this.pongTimer]) if (t) clearTimeout(t);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = this.pongTimer = this.pingTimer = null;
  }

  private setStatus(s: RelayStatus) {
    if (s === this.status) return;
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }
}
