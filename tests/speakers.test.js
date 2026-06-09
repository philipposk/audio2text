import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createJob } from '../server/db/index.js';

process.env.NODE_ENV = 'test';

let app;
beforeAll(async () => {
  const mod = await import('../server/index.js');
  app = mod.createApp({ withWebsocket: false });
});

describe('PATCH /api/jobs/:id/speakers', () => {
  it('renames and merges speakers', async () => {
    const source = await createJob({
      type: 'diarization',
      task: 'diarize',
      text: 'x',
      segments: [
        { start: 0, end: 1, speaker: 'SPEAKER_00', text: 'hi' },
        { start: 1, end: 2, speaker: 'SPEAKER_01', text: 'hello' },
        { start: 2, end: 3, speaker: 'SPEAKER_02', text: 'sup' }
      ]
    });

    const res = await request(app)
      .patch(`/api/jobs/${source.id}/speakers`)
      .send({
        renames: { SPEAKER_00: 'Alice', SPEAKER_01: 'Bob' },
        merge: [['SPEAKER_01', 'SPEAKER_02']]
      });

    expect(res.status).toBe(200);
    expect(res.body.job.speakers).toEqual(expect.arrayContaining(['Alice', 'Bob']));

    const fetched = await request(app).get(`/api/jobs/${source.id}`);
    const seg = fetched.body.job.segments;
    expect(seg[0].speaker).toBe('Alice');
    expect(seg[1].speaker).toBe('Bob');
    expect(seg[2].speaker).toBe('Bob'); // merged into Bob
  });

  it('404 on missing job', async () => {
    const res = await request(app)
      .patch('/api/jobs/nope/speakers')
      .send({ renames: {} });
    expect(res.status).toBe(404);
  });
});
