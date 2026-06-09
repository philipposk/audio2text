import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';

let app;
beforeAll(async () => {
  const mod = await import('../server/index.js');
  app = mod.createApp();
});

describe('GET /api/health', () => {
  it('returns service info', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('Translator');
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.providers.openai).toBe('boolean');
  });
});

describe('GET /api/unknown', () => {
  it('returns 404 JSON', async () => {
    const res = await request(app).get('/api/no-such-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});
