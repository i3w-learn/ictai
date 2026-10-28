import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

// Spec 8.1: Hyper-V, WSL, VPN and other virtual adapters are left out of the list.
const VIRTUAL = /(vethernet|wsl|hyper-v|virtualbox|vmware|vbox|docker|br-|veth|utun|tun|tap|tailscale|zerotier|loopback|npcap|bluetooth)/i;

const PRIVATE_V4 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

export function lanAddresses(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (!list || VIRTUAL.test(name)) continue;
    for (const a of list) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (PRIVATE_V4.some((r) => r.test(a.address))) out.push(a.address);
    }
  }
  return out;
}
