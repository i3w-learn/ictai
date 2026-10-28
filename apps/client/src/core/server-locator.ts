import { Health } from '@ict/contracts';
import type { AppKind, FoundServer, Platform } from '../platform/platform';
import type { ServerTarget } from './settings';

// Finds a working address for a server. Spec 8.1: broadcast, then check each address
// with GET /health and keep the first one whose serverId matches.
export class ServerLocator {
  constructor(
    private readonly platform: Platform,
    private readonly app: AppKind,
  ) {}

  discover(): Promise<FoundServer[]> {
    return this.platform.discover(this.app);
  }

  async confirm(found: FoundServer, certFp: string): Promise<ServerTarget | null> {
    const candidates = [found.from, ...found.addrs.filter((a) => a !== found.from)];
    for (const addr of candidates) {
      if (await this.isServer(addr, found.port, certFp, found.serverId)) {
        return { serverId: found.serverId, name: found.name, certFp, addr, port: found.port };
      }
    }
    return null;
  }

  // Used when the saved address stops working (school routers change IPs).
  async relocate(known: ServerTarget): Promise<ServerTarget | null> {
    const match = (await this.discover()).find((f) => f.serverId === known.serverId);
    return match ? this.confirm(match, known.certFp) : null;
  }

  private async isServer(addr: string, port: number, certFp: string, serverId: string): Promise<boolean> {
    try {
      const res = await this.platform.request({ baseUrl: `https://${addr}:${port}`, certFp, method: 'GET', path: '/health' });
      const health = Health.safeParse(res.body);
      return res.status === 200 && health.success && health.data.serverId === serverId;
    } catch {
      return false;
    }
  }
}
