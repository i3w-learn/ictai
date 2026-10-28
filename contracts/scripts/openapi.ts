// Writes contracts/openapi.json from the zod API table. Run: pnpm --filter @ict/contracts openapi
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z, type ZodType } from 'zod';
import { API, ApiError, type Endpoint } from '../src/index.js';

const schema = (s: ZodType) => z.toJSONSchema(s, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any' });

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [key, ep] of Object.entries(API) as [string, Endpoint][]) {
    const [method, path] = key.split(' ') as [string, string];
    const oaPath = path.replace(/:(\w+)/g, '{$1}');
    const parameters = [
      ...[...path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } })),
      ...(ep.query ? Object.keys((ep.query as z.ZodObject).shape).map((name) => ({ name, in: 'query', required: true, schema: { type: 'string' } })) : []),
    ];
    paths[oaPath] ??= {};
    paths[oaPath][method.toLowerCase()] = {
      summary: ep.summary,
      'x-access': ep.access,
      ...(ep.access.kind === 'public' ? {} : { security: [{ bearer: [] }] }),
      ...(parameters.length ? { parameters } : {}),
      ...(ep.body ? { requestBody: { required: true, content: { 'application/json': { schema: schema(ep.body) } } } } : {}),
      responses: {
        [ep.status]: ep.response
          ? { description: 'OK', content: { 'application/json': { schema: schema(ep.response) } } }
          : { description: 'No content' },
        default: { description: 'Error', content: { 'application/json': { schema: schema(ApiError) } } },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: { title: 'ICT App school server', version: '1.0.0' },
    servers: [{ url: 'https://{server}:7700', variables: { server: { default: 'localhost' } } }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    paths,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL('../openapi.json', import.meta.url));
  writeFileSync(out, JSON.stringify(buildOpenApi(), null, 2) + '\n');
  console.log(`wrote ${out}`);
}
