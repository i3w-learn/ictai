import { X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from 'selfsigned';

export interface Tls {
  key: string;
  cert: string;
  fingerprint: string; // SHA-256, the certFp devices pin (spec 8.2)
}

// Makes the server's own certificate once and reuses it. No outside certificate authority needed.
// TODO(M4): protect key.pem with Windows DPAPI (spec 7.3).
export async function loadOrCreateTls(dir: string, serverId: string): Promise<Tls> {
  const keyFile = join(dir, 'key.pem');
  const certFile = join(dir, 'cert.pem');
  if (!existsSync(keyFile) || !existsSync(certFile)) {
    mkdirSync(dir, { recursive: true });
    const tenYears = new Date(Date.now() + 10 * 365 * 24 * 3600_000);
    const pems = await generate([{ name: 'commonName', value: `ict-server-${serverId}` }], {
      keySize: 2048,
      algorithm: 'sha256',
      notAfterDate: tenYears,
    });
    writeFileSync(keyFile, pems.private, { mode: 0o600 });
    writeFileSync(certFile, pems.cert);
  }
  const key = readFileSync(keyFile, 'utf8');
  const cert = readFileSync(certFile, 'utf8');
  return { key, cert, fingerprint: new X509Certificate(cert).fingerprint256 };
}
