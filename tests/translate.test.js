import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';

// Stub the AI helper so tests don't hit a real provider.
vi.mock('../server/utils/ai.js', () => ({
  chatComplete: vi.fn(async ({ messages }) => {
    const last = messages[messages.length - 1].content;
    // Echo input so we can assert payload shape.
    if (last.startsWith('1. ')) {
      const count = last.split('\n').length;
      return {
        text: JSON.stringify({ translations: Array(count).fill('TRANSLATED') }),
        usage: { total_tokens: 1 },
        provider: 'mock',
        model: 'mock-1'
      };
    }
    return {
      text: 'TRANSLATED: ' + last,
      usage: { total_tokens: 1 },
      provider: 'mock',
      model: 'mock-1'
    };
  })
}));

let app;
beforeAll(async () => {
  const mod = await import('../server/index.js');
  app = mod.createApp();
});

describe('POST /api/translate', () => {
  it('rejects missing text', async () => {
    const res = await request(app).post('/api/translate').send({ targetLang: 'en' });
    expect(res.status).toBe(400);
  });

  it('rejects missing targetLang', async () => {
    const res = await request(app).post('/api/translate').send({ text: 'hello' });
    expect(res.status).toBe(400);
  });

  it('translates simple text', async () => {
    const res = await request(app)
      .post('/api/translate')
      .send({ text: 'Καλημέρα', sourceLang: 'el', targetLang: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.translation).toContain('TRANSLATED');
    expect(res.body.targetLang).toBe('en');
  });

  it('returns 413 on huge input', async () => {
    const huge = 'x'.repeat(50_001);
    const res = await request(app)
      .post('/api/translate')
      .send({ text: huge, targetLang: 'en' });
    expect(res.status).toBe(413);
  });
});

describe('POST /api/translate/batch', () => {
  it('returns parallel array', async () => {
    const res = await request(app)
      .post('/api/translate/batch')
      .send({ items: ['a', 'b', 'c'], targetLang: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.translations).toHaveLength(3);
    expect(res.body.translations[0]).toBe('TRANSLATED');
  });

  it('rejects empty array', async () => {
    const res = await request(app)
      .post('/api/translate/batch')
      .send({ items: [], targetLang: 'en' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/translate/languages', () => {
  it('lists supported languages', async () => {
    const res = await request(app).get('/api/translate/languages');
    expect(res.status).toBe(200);
    expect(res.body.languages.en).toBe('English');
    expect(res.body.languages.el).toBe('Greek');
  });
});
