// Conversational refinement on top of a transcription. Provider auto-selected
// (Groq preferred, OpenAI fallback) via the shared AI helper.
import express from 'express';
import { chatComplete } from '../utils/ai.js';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { message, transcription, history = [] } = req.body || {};
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const systemPrompt = `You are Translator, an AI assistant specialized in refining audio transcriptions and translations.
Your job:
1. Fix grammar, punctuation, capitalization, paragraph structure.
2. Translate between languages when asked.
3. Answer questions about the transcript.
4. Follow user instructions precisely.

Current transcription:
${transcription || '(none yet)'}`;

    const { text, usage, provider, model } = await chatComplete({
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message }
      ],
      temperature: 0.7,
      maxTokens: 2000
    });

    res.json({ success: true, response: text, usage, provider, model });
  } catch (err) {
    next(err);
  }
});

router.post('/refine', async (req, res, next) => {
  try {
    const { transcription, instructions } = req.body || {};
    if (!transcription || !instructions) {
      return res.status(400).json({ error: 'transcription and instructions are required' });
    }

    const systemPrompt = `You are a transcription refinement expert. Refine the following transcription
according to the user's instructions. Return ONLY the refined text — no commentary.

Original:
${transcription}

Instructions:
${instructions}`;

    const { text, provider, model } = await chatComplete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Refine the transcription per my instructions.' }
      ],
      temperature: 0.3,
      maxTokens: 4000
    });

    res.json({ success: true, refinedTranscription: text, provider, model });
  } catch (err) {
    next(err);
  }
});

export default router;
