import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { computeCutPoints } from '../server/utils/audioChunk.js';
import { filterHallucinations } from '../server/utils/transcription.js';
import { createJob } from '../server/db/index.js';

process.env.NODE_ENV = 'test';
process.env.VERCEL = '1';

// Mock the LLM so question/summary/ask routes are deterministic. Branch on the
// system prompt so one mock serves every route under test.
vi.mock('../server/utils/ai.js', () => ({
  chatComplete: vi.fn(async ({ messages }) => {
    const sys = messages.find((m) => m.role === 'system')?.content || '';
    let text;
    if (/extract the QUESTIONS/i.test(sys)) {
      text = JSON.stringify({
        questions: [
          { question: 'What is the deadline?', askedBy: 'Alice', answered: false, answer: null },
          { question: 'Who owns the fix?', askedBy: 'Bob', answered: true, answer: 'Carol owns it.' }
        ]
      });
    } else if (/transcript summarizer/i.test(sys)) {
      text = JSON.stringify({
        tldr: ['t'], keyPoints: ['k'], actionItems: [{ task: 'do', owner: 'Bob', due: null }],
        topics: ['x'], overview: 'A short meeting.', attendees: ['Alice', 'Bob'],
        sections: [{ title: 'Bug', notes: ['front page bug'], actions: [{ task: 'fix', owner: 'Bob' }] }]
      });
    } else if (/answer questions using ONLY/i.test(sys)) {
      text = 'The deadline is Friday.';
    } else {
      text = '{}';
    }
    return { text, usage: { total_tokens: 1 }, provider: 'mock', model: 'mock-1' };
  })
}));

let app;
beforeAll(async () => {
  const mod = await import('../server/index.js');
  app = mod.createApp({ withWebsocket: false });
});

describe('filterHallucinations (must not wipe non-Latin scripts)', () => {
  const seg = (text, extra = {}) => ({ text, no_speech_prob: 0, avg_logprob: -0.05, ...extra });

  it('keeps real speech in Greek, Cyrillic, and CJK', () => {
    for (const text of ['Καλημέρα σε όλους.', 'Привет мир', '你好世界', 'Good morning.']) {
      const out = filterHallucinations({ segments: [seg(text)], text });
      expect(out.segments).toHaveLength(1);
      expect(out.text).toBe(text);
    }
  });

  it('still drops punctuation/symbol/whitespace-only and known boilerplate', () => {
    const segs = [
      seg('...'), seg('   '), seg('♪'),
      seg('Subtitles by amara.org'),
      seg('Καλημέρα.') // real → survives
    ];
    const out = filterHallucinations({ segments: segs, text: '' });
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0].text).toBe('Καλημέρα.');
  });

  it('drops low-confidence non-speech segments regardless of script', () => {
    const out = filterHallucinations({
      segments: [seg('εεεμ', { no_speech_prob: 0.9, avg_logprob: -0.8 }), seg('Γεια.')],
      text: ''
    });
    expect(out.segments.map(s => s.text)).toEqual(['Γεια.']);
  });
});

describe('computeCutPoints (VAD-aware chunking)', () => {
  it('snaps cut points to nearby silences', () => {
    // 60-min audio, 25-min chunks; silence gaps near each ideal cut.
    const silences = [{ start: 1490, end: 1500 }, { start: 2990, end: 3000 }];
    const cuts = computeCutPoints(3600, silences, 1500, 45);
    expect(cuts[0]).toBeCloseTo(1495, 0); // midpoint of first gap, near 1500
    expect(cuts.every((c, i) => i === 0 || c > cuts[i - 1])).toBe(true);
  });

  it('falls back to fixed cuts when no silence is in range', () => {
    const cuts = computeCutPoints(3000, [], 1500, 45);
    expect(cuts).toEqual([1500]);
  });

  it('returns no cuts for short audio', () => {
    expect(computeCutPoints(600, [], 1500)).toEqual([]);
  });
});

describe('GET /api/jobs (cross-job search snippet)', () => {
  it('returns a matched-excerpt snippet when q is given', async () => {
    await createJob({ type: 'transcription', text: 'the quarterly revenue projections look strong this year', language: 'en' });
    const res = await request(app).get('/api/jobs?q=revenue');
    expect(res.status).toBe(200);
    const hit = res.body.jobs.find((j) => (j.snippet || '').includes('revenue'));
    expect(hit).toBeTruthy();
    expect(hit.snippet).toContain('revenue');
    expect(hit.text).toBeUndefined(); // full transcript never shipped in list
  });
});

describe('POST /api/questions', () => {
  it('detects questions and counts open ones', async () => {
    const res = await request(app).post('/api/questions').send({ transcription: 'Alice: what is the deadline? Bob: who owns the fix?' });
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(2);
    expect(res.body.openCount).toBe(1);
    expect(res.body.questions[0].question).toMatch(/deadline/i);
  });

  it('400 without transcription or jobId', async () => {
    const res = await request(app).post('/api/questions').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/jobs/:id/ask (grounded Q&A)', () => {
  it('answers from the transcript', async () => {
    const job = await createJob({ type: 'transcription', text: 'The deadline is Friday.', segments: [{ start: 0, end: 1, text: 'The deadline is Friday.' }] });
    const res = await request(app).post(`/api/jobs/${job.id}/ask`).send({ question: 'When is the deadline?' });
    expect(res.status).toBe(200);
    expect(res.body.answer).toMatch(/Friday/);
  });

  it('400 without question', async () => {
    const job = await createJob({ type: 'transcription', text: 'x' });
    const res = await request(app).post(`/api/jobs/${job.id}/ask`).send({});
    expect(res.status).toBe(400);
  });

  it('404 for unknown job', async () => {
    const res = await request(app).post('/api/jobs/nope/ask').send({ question: 'hi' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/summary (meeting mode)', () => {
  it('returns attendees + sections for kind=meeting', async () => {
    const res = await request(app).post('/api/summary').send({ transcription: 'some meeting talk', kind: 'meeting' });
    expect(res.status).toBe(200);
    expect(res.body.summary.attendees).toContain('Alice');
    expect(res.body.summary.sections[0].title).toBe('Bug');
    expect(res.body.summary.overview).toBeTruthy();
  });
});
