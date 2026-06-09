import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';

let app;
beforeAll(async () => {
  const mod = await import('../server/index.js');
  app = mod.createApp({ withWebsocket: false });
});

describe('GET /api/openapi.json', () => {
  it('returns OpenAPI document', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info.title).toBe('Translator API');
    expect(res.body.paths['/api/translate']).toBeTruthy();
    expect(res.body.paths['/api/jobs/{id}/speakers']).toBeTruthy();
    expect(res.body.components.securitySchemes.ApiKeyHeader.in).toBe('header');
  });
});
