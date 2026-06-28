// POST /api/summary — generate a structured summary of a transcript.
//
// Body (one of):
//   { transcription: string }
//   { jobId: string }                 // resolves stored transcript
// Optional:
//   { kind: 'meeting' | 'lecture' | 'podcast' | 'generic', targetLang?: string, length?: 'short'|'normal'|'long' }
//
// Returns strict JSON: { tldr, keyPoints[], actionItems[], topics[] }

import express from 'express';
import { chatComplete } from '../utils/ai.js';
import { getJob } from '../db/index.js';

const router = express.Router();

const KIND_GUIDANCE = {
  meeting:  'This is a meeting transcript. Surface decisions, owners, and deadlines.',
  lecture:  'This is a lecture transcript. Surface definitions, examples, and conclusions.',
  podcast:  'This is a podcast transcript. Surface segments, guests, and notable quotes.',
  generic:  'Treat this as a generic transcript.'
};

const LENGTH_GUIDANCE = {
  short:  '3-bullet TL;DR, max 5 key points.',
  normal: '5-bullet TL;DR, max 10 key points.',
  long:   '8-bullet TL;DR, max 20 key points.'
};

router.post('/', async (req, res, next) => {
  try {
    let { transcription, jobId, kind = 'generic', targetLang, length = 'normal' } = req.body || {};

    if (jobId && !transcription) {
      const job = await getJob(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      transcription = job.text;
    }
    if (!transcription || transcription.trim().length === 0) {
      return res.status(400).json({ error: 'transcription or jobId required' });
    }
    if (transcription.length > 60_000) {
      return res.status(413).json({ error: 'Transcript too long for single-pass summary (max 60k chars).' });
    }

    const kindHint = KIND_GUIDANCE[kind] || KIND_GUIDANCE.generic;
    const lengthHint = LENGTH_GUIDANCE[length] || LENGTH_GUIDANCE.normal;
    const langClause = targetLang ? ` Write all output in ${targetLang}.` : '';

    // Meeting kind also produces meeting-intelligence fields: a narrative
    // overview, the list of attendees/speakers, and per-topic sections each
    // with its own notes + owner-attributed actions.
    const meeting = kind === 'meeting';
    const meetingHint = meeting
      ? `\nAlso fill "overview" (2-4 sentence narrative), "attendees" (names/speakers heard), and "sections" (one per distinct topic, each with its own "notes" and owner-attributed "actions"). Use speaker labels from the transcript as owners when present. Leave a field as [] or "" if genuinely absent — never invent attendees or owners.`
      : '\nLeave "overview" "", and "attendees"/"sections" as []. ';

    const systemPrompt = `You are a transcript summarizer. ${kindHint}
Return STRICT JSON with this exact schema:
{
  "tldr": [ "string", ... ],
  "keyPoints": [ "string", ... ],
  "actionItems": [ { "task": "string", "owner": "string|null", "due": "string|null" }, ... ],
  "topics": [ "string", ... ],
  "overview": "string",
  "attendees": [ "string", ... ],
  "sections": [ { "title": "string", "notes": [ "string", ... ], "actions": [ { "task": "string", "owner": "string|null" }, ... ] }, ... ]
}
${lengthHint}${meetingHint}${langClause}
No markdown, no commentary, no extra keys.`;

    const { text: raw, usage, provider, model } = await chatComplete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcription }
      ],
      temperature: 0.2,
      maxTokens: 2000
    });

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '').trim());
    } catch {
      return res.status(502).json({ error: 'LLM returned non-JSON summary', raw });
    }

    res.json({
      success: true,
      summary: {
        tldr: parsed.tldr || [],
        keyPoints: parsed.keyPoints || [],
        actionItems: parsed.actionItems || [],
        topics: parsed.topics || [],
        overview: parsed.overview || '',
        attendees: parsed.attendees || [],
        sections: Array.isArray(parsed.sections) ? parsed.sections : []
      },
      provider,
      model,
      usage
    });
  } catch (err) {
    next(err);
  }
});

export default router;
