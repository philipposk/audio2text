// Vercel serverless mirror of /api/translate.
// Uses Groq if configured, otherwise OpenAI. No persistence (stateless).

import OpenAI from 'openai';
import Groq from 'groq-sdk';

const LANG_NAMES = {
  en: 'English', el: 'Greek', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', pt: 'Portuguese', ru: 'Russian', zh: 'Chinese', ja: 'Japanese',
  ko: 'Korean', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish', nl: 'Dutch'
};

function languageName(code) {
  if (!code) return null;
  return LANG_NAMES[code.toLowerCase()] || code;
}

async function chatComplete(messages) {
  if (process.env.GROQ_API_KEY) {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const c = await groq.chat.completions.create({
      model: 'llama-3.1-70b-versatile',
      messages,
      temperature: 0.2,
      max_tokens: 4000
    });
    return { text: c.choices[0].message.content, provider: 'groq', model: 'llama-3.1-70b-versatile', usage: c.usage };
  }
  if (process.env.OPENAI_API_KEY) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const c = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.2,
      max_tokens: 4000
    });
    return { text: c.choices[0].message.content, provider: 'openai', model: 'gpt-4o-mini', usage: c.usage };
  }
  const e = new Error('No AI API key configured.');
  e.status = 500;
  throw e;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { text, targetLang, sourceLang, preserveFormatting = true } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Field "text" (string) is required.' });
    }
    if (!targetLang) {
      return res.status(400).json({ error: 'Field "targetLang" is required.' });
    }
    if (text.length > 50_000) {
      return res.status(413).json({ error: 'Input too long (max 50000 chars).' });
    }

    const target = languageName(targetLang);
    const source = languageName(sourceLang) || 'auto-detected source language';

    const systemPrompt = `You are a professional translator. Translate from ${source} into ${target}.
Rules:
- Return ONLY the translated text. No preamble, no notes.
- ${preserveFormatting ? 'Preserve line breaks, lists, and markdown.' : 'Produce clean prose.'}
- Keep proper nouns and code identifiers untranslated.`;

    const { text: translated, provider, model, usage } = await chatComplete([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ]);

    res.json({
      success: true,
      translation: translated,
      sourceLang: sourceLang || null,
      targetLang,
      provider,
      model,
      usage
    });
  } catch (err) {
    console.error('translate error', err);
    res.status(err.status || 500).json({ error: err.message || 'Translation failed' });
  }
}
