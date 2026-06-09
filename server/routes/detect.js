// POST /api/detect-language
//
// Accepts either:
//   - multipart audio file (Whisper verbose_json returns `language`)
//   - JSON body { text } (LLM classifies)
//
// Returns: { language: 'el', name: 'Greek', confidence: 0.0-1.0, method }

import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { transcribeAudio } from '../utils/transcription.js';
import { chatComplete } from '../utils/ai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();
const upload = multer({
  dest: join(__dirname, '../../uploads'),
  limits: { fileSize: 25 * 1024 * 1024 }
});

const LANG_NAMES = {
  en: 'English', el: 'Greek', es: 'Spanish', fr: 'French', de: 'German',
  it: 'Italian', pt: 'Portuguese', ru: 'Russian', zh: 'Chinese', ja: 'Japanese',
  ko: 'Korean', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish', nl: 'Dutch'
};

router.post('/', upload.single('audio'), async (req, res, next) => {
  let filePath;
  try {
    // Audio path: short clip transcription, read `language` from verbose_json.
    if (req.file) {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ error: 'OPENAI_API_KEY required for audio detection' });
      }
      filePath = req.file.path;
      const result = await transcribeAudio(filePath, {
        task: 'transcribe',
        language: undefined, // let Whisper auto-detect
        response_format: 'verbose_json'
      });
      const code = result.language || null;
      return res.json({
        language: code,
        name: code ? (LANG_NAMES[code] || code) : null,
        confidence: 0.9,
        method: 'whisper',
        sampleText: (result.text || '').slice(0, 200)
      });
    }

    // Text path.
    const { text } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'audio file or "text" required' });
    }
    if (text.length > 5000) {
      return res.status(413).json({ error: 'Text too long (max 5000 chars).' });
    }

    const { text: raw } = await chatComplete({
      messages: [
        {
          role: 'system',
          content: 'Identify the language of the user text. Reply with STRICT JSON: {"code":"<iso639-1>","name":"<English name>","confidence":0..1}. No commentary.'
        },
        { role: 'user', content: text }
      ],
      temperature: 0,
      maxTokens: 100
    });

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '').trim());
    } catch {
      return res.status(502).json({ error: 'LLM returned non-JSON', raw });
    }
    res.json({
      language: parsed.code || null,
      name: parsed.name || null,
      confidence: parsed.confidence ?? null,
      method: 'llm'
    });
  } catch (err) {
    next(err);
  } finally {
    if (filePath) await fs.unlink(filePath).catch(() => {});
  }
});

export default router;
