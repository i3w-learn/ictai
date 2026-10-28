import { describe, expect, it } from 'vitest';
import { API } from '@ict/contracts';
import { buildOpenApi } from '@ict/contracts/openapi';
import { testServer } from './helpers.js';

// Spec 15 contract test: the server serves exactly the endpoints in the shared contract.
describe('API contract', () => {
  it('server routes match the contract table', async () => {
    const { app } = await testServer();
    const served: string[] = [];
    for (const key of Object.keys(API)) {
      const [method, url] = key.split(' ') as [string, string];
      if (app.hasRoute({ method: method as 'GET', url })) served.push(key);
    }
    expect(served.sort()).toEqual(Object.keys(API).sort());
  });

  it('every protected route rejects a call with no token', async () => {
    const { app } = await testServer();
    for (const [key, ep] of Object.entries(API)) {
      if (ep.access.kind === 'public') continue;
      const [method, url] = key.split(' ') as [string, string];
      const res = await app.inject({ method: method as 'GET', url: url.replace(':id', '00000000-0000-4000-8000-000000000000') });
      expect(res.statusCode, key).toBe(401);
    }
  });

  it('builds an OpenAPI document covering every endpoint', () => {
    const doc = buildOpenApi();
    const count = Object.values(doc.paths).reduce((n, ops) => n + Object.keys(ops).length, 0);
    expect(count).toBe(Object.keys(API).length);
  });
});
