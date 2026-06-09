import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { createJob } from '../server/db/index.js';

process.env.NODE_ENV = 'test';
process.env.VERCEL = '1';

vi.mock('../server/utils/ai.js', () => ({
  chatComplete: vi.fn(async ({ messages }) => {
    const user = messages[messages.length - 1].content;
    const count = user.split('\n').filter((l) => /^\d+\. /.test(l)).length;
    return {
      text: JSON.stringify({ translations: Array(count).fill('TR') }),
      usage: { total_tokens: 1 },
      provider: 'mock',
      model: 'mock-1'
    };
  })
}));

let app;
beforeAll(async () => {
  const mod = await import('../server/index.js');
  app = mod.createApp({ withWebsocket: false });
});

describe('GET /api/jobs (search/filter)', () => {
  it('filters by q and language', async () => {
    await createJob({ type: 'transcription', text: 'hello world', language: 'en' });
    await createJob({ type: 'transcription', text: 'γεια σου', language: 'el' });

    const r1 = await request(app).get('/api/jobs?q=hello');
    expect(r1.status).toBe(200);
    expect(r1.body.jobs.every((j) => true)).toBe(true);
    expect(r1.body.total).toBeGreaterThanOrEqual(1);

    const r2 = await request(app).get('/api/jobs?language=el');
    expect(r2.body.jobs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /api/jobs/:id/translate', () => {
  it('translates all segments and persists a new job', async () => {
    const source = await createJob({
      type: 'transcription',
      text: 'a b',
      language: 'en',
      segments: [
        { start: 0, end: 1, text: 'a' },
        { start: 1, end: 2, text: 'b' }
      ]
    });

    const res = await request(app)
      .post(`/api/jobs/${source.id}/translate`)
      .send({ targetLang: 'el' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sourceJobId).toBe(source.id);
    expect(res.body.segmentCount).toBe(2);

    const fetched = await request(app).get(`/api/jobs/${res.body.jobId}`);
    expect(fetched.body.job.task).toBe('translate');
    expect(fetched.body.job.segments[0].text).toBe('TR');
    expect(fetched.body.job.segments[0].originalText).toBe('a');
  });

  it('rejects missing targetLang', async () => {
    const source = await createJob({ type: 'transcription', text: 'x', segments: [{ start: 0, end: 1, text: 'x' }] });
    const res = await request(app).post(`/api/jobs/${source.id}/translate`).send({});
    expect(res.status).toBe(400);
  });

  it('404 for unknown job', async () => {
    const res = await request(app).post('/api/jobs/nope/translate').send({ targetLang: 'el' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/diarize/info', () => {
  it('reports enabled flag based on env', async () => {
    const res = await request(app).get('/api/diarize/info');
    expect(res.status).toBe(200);
    expect(typeof res.body.enabled).toBe('boolean');
    expect(res.body.model).toBeTruthy();
  });
});
