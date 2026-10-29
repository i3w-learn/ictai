import { ClientMsg, type Principal, type RelayEnvelope } from '@ict/contracts';
import type { Clock } from '../core/clock.js';

// One kind of room, e.g. "quiz:<runId>". The kind decides who may join and what each member sees.
export interface RoomKind {
  prefix: string;
  canJoin(p: Principal, id: string): boolean;
  snapshot(p: Principal, id: string): unknown;
}

export interface Conn {
  send(text: string): void;
  close(code: number, reason: string): void;
}

interface Member {
  conn: Conn;
  principal: Principal;
}

// Spec 8.3: live room state is in memory. Writes go over REST; the relay pushes a fresh
// `state` snapshot to each member on join and whenever the room changes.
export class Relay {
  private kinds = new Map<string, RoomKind>();
  private rooms = new Map<string, Set<Member>>();
  private seqs = new Map<string, number>();

  constructor(
    private readonly now: Clock,
    private readonly log: (err: unknown) => void = () => {},
  ) {}

  register(kind: RoomKind) {
    this.kinds.set(kind.prefix, kind);
  }

  // Returns the handlers for one socket's lifetime.
  attach(conn: Conn, principal: Principal) {
    const member: Member = { conn, principal };
    const joined = new Set<string>();
    this.send(member, { t: 'hello', ts: this.now(), p: { serverTime: this.now() } });

    return {
      message: (text: string) => {
        // One bad message is logged and dropped; it never takes the socket or the server down.
        try {
          this.handle(member, joined, text);
        } catch (err) {
          this.log(err);
          this.send(member, { t: 'error', ts: this.now(), p: { code: 'INTERNAL', message: 'Message failed.' } });
        }
      },
      close: () => {
        for (const room of joined) this.rooms.get(room)?.delete(member);
        joined.clear();
      },
    };
  }

  // Sends every member of the room a fresh snapshot, built for that member.
  notify(room: string) {
    const members = this.rooms.get(room);
    if (!members?.size) return;
    const kind = this.kindOf(room);
    if (!kind) return;
    const seq = this.nextSeq(room);
    for (const m of members) {
      try {
        this.send(m, { t: 'state', room, seq, ts: this.now(), p: kind.snapshot(m.principal, idOf(room)) });
      } catch (err) {
        this.log(err);
      }
    }
  }

  private handle(m: Member, joined: Set<string>, text: string) {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return this.error(m, 'BAD_MESSAGE', 'Not JSON.');
    }
    const parsed = ClientMsg.safeParse(raw);
    if (!parsed.success) return this.error(m, 'BAD_MESSAGE', 'Unknown message.');
    const msg = parsed.data;

    switch (msg.t) {
      case 'ping':
        return this.send(m, { t: 'pong', ts: this.now(), id: msg.id });
      case 'leave':
        joined.delete(msg.room);
        this.rooms.get(msg.room)?.delete(m);
        return;
      case 'join': {
        const kind = this.kindOf(msg.room);
        if (!kind || !kind.canJoin(m.principal, idOf(msg.room))) {
          return this.error(m, 'FORBIDDEN', 'You cannot join this room.', msg.room, msg.id);
        }
        if (!this.rooms.has(msg.room)) this.rooms.set(msg.room, new Set());
        this.rooms.get(msg.room)!.add(m);
        joined.add(msg.room);
        // Late joiners get the current state at once.
        const p = kind.snapshot(m.principal, idOf(msg.room));
        return this.send(m, { t: 'state', room: msg.room, seq: this.seqs.get(msg.room) ?? 0, ts: this.now(), id: msg.id, p });
      }
    }
  }

  private kindOf(room: string) {
    return this.kinds.get(room.slice(0, room.indexOf(':')));
  }

  private nextSeq(room: string) {
    const seq = (this.seqs.get(room) ?? 0) + 1;
    this.seqs.set(room, seq);
    return seq;
  }

  private error(m: Member, code: string, message: string, room?: string, id?: string) {
    this.send(m, { t: 'error', room, id, ts: this.now(), p: { code, message } });
  }

  private send(m: Member, env: RelayEnvelope) {
    m.conn.send(JSON.stringify(env));
  }
}

const idOf = (room: string) => room.slice(room.indexOf(':') + 1);
