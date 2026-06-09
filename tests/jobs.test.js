import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createJob } from '../server/db/index.js';

process.env.NODE_ENV = 'test';
process.env.VERCEL = '1'; // Force in-memory adapter for test isolation.

let app;
beforeAll(async () => {
  const mod = await import('../server/index.js');
  app = mod.createApp();
});

describe('jobs persistence', () => {
  it('creates and lists a job', async () => {
    const job = await createJob({
      type: 'transcription',
      text: 'hello world',
      language: 'en',
      segments: [{ start: 0, end: 1, text: 'hello world' }]
    });
    expect(job.id).toBeTruthy();

    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body.jobs.find((j) => j.id === job.id)).toBeTruthy();
  });

  it('fetches a single job with segments', async () => {
    const job = await createJob({ type: 'transcription', text: 'x' });
    const res = await request(app).get(`/api/jobs/${job.id}`);
    expect(res.status).toBe(200);
    expect(res.body.job.id).toBe(job.id);
  });

  it('returns 404 for missing job', async () => {
    const res = await request(app).get('/api/jobs/does-not-exist');
    expect(res.status).toBe(404);
  });
});
