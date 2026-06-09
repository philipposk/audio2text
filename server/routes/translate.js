import express from 'express';
import { chatComplete } from '../utils/ai.js';
import { getGlossary } from '../db/index.js';

const router = express.Router();

// ISO 639-1 → display name, used to instruct the LLM clearly.
const LANG_NAMES = {
  en: 'English', el: 'Greek', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', pt: 'Portuguese', ru: 'Russian', zh: 'Chinese', ja: 'Japanese',
  ko: 'Korean', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish', nl: 'Dutch',
  pl: 'Polish', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish',
  cs: 'Czech', uk: 'Ukrainian', he: 'Hebrew', ro: 'Romanian', hu: 'Hungarian'
};

function languageName(code) {
  if (!code) return null;
  return LANG_NAMES[code.toLowerCase()] || code;
}

// Hard cap so a single request can't blow the LLM context.
const MAX_INPUT_CHARS = 50_000;

// POST /api/translate
// Body: { text, targetLang, sourceLang?, preserveFormatting?, glossary? }
router.post('/', async (req, res, next) => {
  try {
    const { text, targetLang, sourceLang, preserveFormatting = true, glossary, glossaryId } = req.body || {};

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Field "text" (string) is required.' });
    }
    if (!targetLang) {
      return res.status(400).json({ error: 'Field "targetLang" is required (e.g. "en", "el").' });
    }
    if (text.length > MAX_INPUT_CHARS) {
      return res.status(413).json({
        error: `Input too long (${text.length} chars). Max ${MAX_INPUT_CHARS}. Split and translate in chunks.`
      });
    }

    const target = languageName(targetLang);
    const source = languageName(sourceLang) || 'auto-detected source language';

    // Merge inline glossary with any stored glossary referenced by id.
    let mergedGlossary = null;
    if (glossaryId) {
      const stored = await getGlossary(glossaryId);
      if (!stored) return res.status(404).json({ error: `glossaryId not found: ${glossaryId}` });
      mergedGlossary = { ...stored.entries };
    }
    if (glossary && typeof glossary === 'object') {
      mergedGlossary = { ...(mergedGlossary || {}), ...glossary };
    }
    const glossaryBlock = mergedGlossary && Object.keys(mergedGlossary).length
      ? `\nGlossary (preserve these mappings exactly):\n${Object.entries(mergedGlossary)
          .map(([k, v]) => `- "${k}" → "${v}"`)
          .join('\n')}`
      : '';

    const systemPrompt = `You are a professional translator. Translate the user's text from ${source} into ${target}.
Rules:
- Return ONLY the translated text. No preamble, no notes, no quotes around output.
- ${preserveFormatting ? 'Preserve line breaks, lists, punctuation, and any markdown.' : 'Produce clean prose.'}
- Keep proper nouns, brand names, and code/identifiers untranslated.
- Match the register (formal/informal) of the source.${glossaryBlock}`;

    const { text: translated, usage, provider, model } = await chatComplete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      temperature: 0.2,
      maxTokens: 4000
    });

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
    next(err);
  }
});

// Batch translation — accepts an array of strings, returns parallel array.
// Useful for translating subtitle segments without losing alignment.
router.post('/batch', async (req, res, next) => {
  try {
    const { items, targetLang, sourceLang } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Field "items" must be a non-empty array of strings.' });
    }
    if (!targetLang) {
      return res.status(400).json({ error: 'Field "targetLang" is required.' });
    }
    if (items.length > 500) {
      return res.status(413).json({ error: 'Batch too large. Max 500 items per call.' });
    }

    const target = languageName(targetLang);
    const source = languageName(sourceLang) || 'auto-detected source language';

    // Single LLM call with numbered items; ask for strict JSON to preserve order.
    const numbered = items.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const systemPrompt = `You translate subtitle/text segments from ${source} into ${target}.
Return STRICT JSON: {"translations": ["...", "..."]} where the array has exactly ${items.length} entries in input order.
No markdown, no commentary, no extra keys.`;

    const { text: raw, usage, provider, model } = await chatComplete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: numbered }
      ],
      temperature: 0.2,
      maxTokens: 4000
    });

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '').trim());
    } catch {
      return res.status(502).json({ error: 'LLM returned non-JSON response.', raw });
    }
    if (!parsed.translations || parsed.translations.length !== items.length) {
      return res.status(502).json({ error: 'Translation count mismatch.', got: parsed });
    }

    res.json({
      success: true,
      translations: parsed.translations,
      sourceLang: sourceLang || null,
      targetLang,
      provider,
      model,
      usage
    });
  } catch (err) {
    next(err);
  }
});

router.get('/languages', (req, res) => {
  res.json({ languages: LANG_NAMES });
});

export default router;
