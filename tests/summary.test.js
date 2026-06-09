import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';

vi.mock('../server/utils/ai.js', () => ({
  chatComplete: vi.fn(async () => ({
    text: JSON.stringify({
      tldr: ['one', 'two', 'three'],
      keyPoints: ['kp1', 'kp2'],
      actionItems: [{ task: 'do x', owner: 'alice', due: 'fri' }],
      topics: ['greek']
    }),
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

describe('POST /api/summary', () => {
  it('rejects empty', async () => {
    const res = await request(app).post('/api/summary').send({});
    expect(res.status).toBe(400);
  });

  it('returns structured summary', async () => {
    const res = await request(app)
      .post('/api/summary')
      .send({ transcription: 'A long boring transcript about Greek economy reform.', kind: 'meeting' });
    expect(res.status).toBe(200);
    expect(res.body.summary.tldr).toHaveLength(3);
    expect(res.body.summary.keyPoints).toHaveLength(2);
    expect(res.body.summary.actionItems[0].task).toBe('do x');
  });

  it('rejects oversize input', async () => {
    const huge = 'x'.repeat(60_001);
    const res = await request(app).post('/api/summary').send({ transcription: huge });
    expect(res.status).toBe(413);
  });
});
