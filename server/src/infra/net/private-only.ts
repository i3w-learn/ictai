import type { Server, Socket } from 'node:net';
import { lanAddresses } from './addresses.js';

const LOOPBACK = new Set(['127.0.0.1', '::1']);

export function isAllowedLocalAddress(local: string | undefined, allowed: string[]): boolean {
  const addr = (local ?? '').replace(/^::ffff:/, '');
  return LOOPBACK.has(addr) || allowed.includes(addr);
}

// Spec 7.1: serve only on private network adapters (and loopback for the console).
// We listen on all addresses so a changed IP keeps working, and drop connections
// that arrived on any other adapter (public, VPN, virtual).
export function acceptPrivateOnly(server: Server, allowed: () => string[] = lanAddresses) {
  server.on('connection', (socket: Socket) => {
    if (!isAllowedLocalAddress(socket.localAddress, allowed())) socket.destroy();
  });
}
