import { join, resolve } from 'node:path';
import { PORTS } from '@ict/contracts';
import { parseKey } from './modules/content/lock.js';

// The key that opens our locked videos and books. The build that makes the Windows installer writes
// it in here (server/scripts/build.mjs); it is never in the code. A server run from the code has none
// unless ICT_CONTENT_KEY is set.
declare const __ICT_CONTENT_KEY__: string | undefined;
const builtInKey = typeof __ICT_CONTENT_KEY__ === 'string' ? __ICT_CONTENT_KEY__ : undefined;

export interface Config {
  version: string;
  dataDir: string;
  dbFile: string;
  tlsDir: string;
  lockFile: string;
  startupLog: string;
  bootstrapAdminFile: string;
  // Videos that come with the app: the installer puts them beside the server program.
  starterDir: string;
  contentKey: Buffer | null;
  apiPort: number;
  beaconPort: number;
  devAdmin: { username: string; password: string } | null;
  ai: AiConfig;
}

// Spec 9: the AI runtime's folder (manifest.json, the model file, llama-server) and its localhost port.
export interface AiConfig {
  dir: string;
  port: number;
  threads: number | null;
  bin: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.ICT_DATA_DIR ?? '.data');
  return {
    version: '0.1.0',
    dataDir,
    dbFile: join(dataDir, 'ict.db'),
    tlsDir: join(dataDir, 'tls'),
    lockFile: join(dataDir, 'server.lock'),
    startupLog: join(dataDir, 'startup.log'),
    bootstrapAdminFile: join(dataDir, 'bootstrap-admin.json'),
    starterDir: resolve(env.ICT_STARTER_DIR ?? 'starter-videos'),
    contentKey: parseKey(env.ICT_CONTENT_KEY || builtInKey),
    apiPort: Number(env.ICT_PORT ?? PORTS.api),
    beaconPort: Number(env.ICT_BEACON_PORT ?? PORTS.beacon),
    devAdmin:
      env.ICT_DEV_ADMIN_USER && env.ICT_DEV_ADMIN_PASSWORD
        ? { username: env.ICT_DEV_ADMIN_USER, password: env.ICT_DEV_ADMIN_PASSWORD }
        : null,
    ai: {
      dir: env.ICT_AI_DIR ? resolve(env.ICT_AI_DIR) : join(dataDir, 'ai'),
      port: Number(env.ICT_AI_PORT ?? 7702),
      threads: env.ICT_AI_THREADS ? Number(env.ICT_AI_THREADS) : null,
      bin: env.ICT_AI_BIN ?? null,
    },
  };
}
