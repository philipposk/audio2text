import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApiKey } from '../server/db/index.js';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'admin-test-key';

let app;
beforeAll(async () => {
  const mod = await import('../server/index.js');
  app = mod.createApp({ withWebsocket: false });
});

describe('admin /api/keys', () => {
  it('rejects without admin key', async () => {
    const res = await request(app).get('/api/keys');
    expect(res.status).toBe(403);
  });

  it('creates and lists keys with admin', async () => {
    const create = await request(app)
      .post('/api/keys')
      .set('x-api-key', 'admin-test-key')
      .send({ label: 't1', dailyMinutes: 5 });
    expect(create.status).toBe(200);
    expect(create.body.apiKey.key).toMatch(/^tr_/);

    const list = await request(app).get('/api/keys').set('x-api-key', 'admin-test-key');
    expect(list.status).toBe(200);
    expect(list.body.keys.length).toBeGreaterThan(0);
    // masked
    expect(list.body.keys[0].key.endsWith('…')).toBe(true);
  });

  it('revokes a key', async () => {
    const rec = await createApiKey({ label: 'revoke-me' });
    const res = await request(app)
      .delete(`/api/keys/${rec.key}`)
      .set('x-api-key', 'admin-test-key');
    expect(res.status).toBe(200);
  });
});

describe('attachApiKey middleware', () => {
  it('passes anonymous when API_KEYS_REQUIRED unset', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
});
