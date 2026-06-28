// POST /api/chapters — split a transcript into titled topic chapters.
//
// Reuses the shared LLM (Groq → OpenAI). Returns chapters with a start time so
// the frontend can render clickable markers that seek the audio/transcript.
//
// Body: { jobId } OR { transcription, segments? }
//   - jobId: resolves text+segments from the store (preferred — gives timings)
//   - transcription/segments: pass directly

import express from 'express';
import { getJob } from '../db/index.js';
import { chatComplete } from '../utils/ai.js';

const router = express.Router();

// Build a compact, timestamped transcript for the LLM, bounded so we don't blow
// the context window on very long recordings.
function buildTimedText(segments, fallbackText, maxChars = 14000) {
  if (Array.isArray(segments) && segments.length) {
    let out = '';
    for (const s of segments) {
      const t = Math.floor(s.start || 0);
      const line = `[${t}] ${(s.text || '').trim()}\n`;
      if (out.length + line.length > maxChars) break;
      out += line;
    }
    return out;
  }
  return (fallbackText || '').slice(0, maxChars);
}

router.post('/', async (req, res, next) => {
  try {
    let { transcription, segments } = req.body || {};
    const { jobId } = req.body || {};
    if (jobId) {
      const job = await getJob(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      transcription = transcription || job.text;
      segments = segments || job.segments;
    }
    if (!transcription && (!segments || !segments.length)) {
      return res.status(400).json({ error: 'transcription or jobId with content required' });
    }

    const timed = buildTimedText(segments, transcription);
    const systemPrompt = `You split a transcript into logical topic chapters.
Each line of the transcript is prefixed with its start time in seconds like "[123] text".
Return STRICT JSON: {"chapters":[{"title":"...","startSec":0,"summary":"..."}]}.
Rules: 3-8 chapters; titles 3-6 words; startSec must be the [seconds] value where the
chapter begins (a real timestamp from the text); summary one sentence. No markdown.`;

    const { text, provider, model } = await chatComplete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: timed }
      ],
      temperature: 0.2,
      maxTokens: 1500
    });

    let parsed;
    try {
      parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim());
    } catch {
      return res.status(502).json({ error: 'LLM returned non-JSON chapters', raw: text });
    }
    const chapters = (parsed.chapters || [])
      .map((c) => ({
        title: String(c.title || 'Untitled').slice(0, 80),
        startSec: Math.max(0, Math.floor(Number(c.startSec) || 0)),
        summary: String(c.summary || '').slice(0, 300)
      }))
      .sort((a, b) => a.startSec - b.startSec);

    res.json({ success: true, chapters, provider, model });
  } catch (err) {
    next(err);
  }
});

export default router;
