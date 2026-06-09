import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';

vi.mock('../server/utils/ai.js', () => ({
  chatComplete: vi.fn(async () => ({
    text: JSON.stringify({ code: 'el', name: 'Greek', confidence: 0.98 }),
    usage: { total_tokens: 1 },
    provider: 'mock',
    model: 'mock-1'
  }))
}));

let app;
beforeAll(async () => {
  const mod = await import('../server/index.js');
  app = mod.createApp({ withWebsocket: false });
});

describe('POST /api/detect-language', () => {
  it('detects text language', async () => {
    const res = await request(app)
      .post('/api/detect-language')
      .send({ text: 'Καλημέρα φίλε μου' });
    expect(res.status).toBe(200);
    expect(res.body.language).toBe('el');
    expect(res.body.name).toBe('Greek');
    expect(res.body.method).toBe('llm');
  });

  it('rejects empty body', async () => {
    const res = await request(app).post('/api/detect-language').send({});
    expect(res.status).toBe(400);
  });

  it('rejects huge text', async () => {
    const res = await request(app)
      .post('/api/detect-language')
      .send({ text: 'x'.repeat(5001) });
    expect(res.status).toBe(413);
  });
});
