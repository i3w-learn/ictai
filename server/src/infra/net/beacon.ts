import { createSocket, type Socket } from 'node:dgram';
import { DiscoverMsg, type HereMsg } from '@ict/contracts';

export interface Beacon {
  port: number;
  close(): Promise<void>;
}

// Spec 8.1: answers "discover" broadcasts on UDP 7701 so devices find the server without a typed IP.
// Anything that isn't a valid discover message is ignored.
export function startBeacon(opts: {
  port: number;
  host?: string;
  here: () => Omit<HereMsg, 't' | 'v'>;
  onAsk?: (from: string) => void;
}): Promise<Beacon> {
  const sock: Socket = createSocket({ type: 'udp4', reuseAddr: true });

  sock.on('message', (buf, rinfo) => {
    if (buf.length > 2048) return;
    let msg: unknown;
    try {
      msg = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }
    if (!DiscoverMsg.safeParse(msg).success) return;
    opts.onAsk?.(rinfo.address);
    const reply: HereMsg = { t: 'here', v: 1, ...opts.here() };
    sock.send(JSON.stringify(reply), rinfo.port, rinfo.address);
  });

  return new Promise((resolve, reject) => {
    sock.once('error', reject);
    sock.bind(opts.port, opts.host, () => {
      sock.off('error', reject);
      sock.on('error', () => {});
      resolve({
        port: sock.address().port,
        close: () => new Promise((r) => sock.close(() => r())),
      });
    });
  });
}
