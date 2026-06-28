// POST /api/questions — detect open/unanswered questions raised in a transcript.
//
// Mirrors the "Open questions" panel of meeting-intelligence tools: surfaces the
// questions someone asked during the conversation and flags which were left
// unanswered, so nothing falls through the cracks after the call.
//
// Body (one of):
//   { transcription: string }
//   { jobId: string }                  // resolves the stored transcript
// Optional:
//   { targetLang?: string }            // write questions/answers in this language
//
// Returns: { questions: [ { question, askedBy, answered, answer } ] }

import express from 'express';
import { chatComplete } from '../utils/ai.js';
import { getJob } from '../db/index.js';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    let { transcription, jobId, targetLang } = req.body || {};

    if (jobId && !transcription) {
      const job = await getJob(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      transcription = job.text;
    }
    if (!transcription || transcription.trim().length === 0) {
      return res.status(400).json({ error: 'transcription or jobId required' });
    }
    if (transcription.length > 60_000) {
      return res.status(413).json({ error: 'Transcript too long (max 60k chars).' });
    }

    const langClause = targetLang ? ` Write the question and answer text in ${targetLang}.` : '';
    const systemPrompt = `You analyze a transcript and extract the QUESTIONS that participants actually asked out loud.
For each, decide whether the transcript itself contains an answer.
Return STRICT JSON: { "questions": [ { "question": "string", "askedBy": "string|null", "answered": true|false, "answer": "string|null" } ] }
- "askedBy": the speaker label/name if identifiable, else null.
- "answered": true only if the answer is clearly stated later in the transcript.
- "answer": the answer from the transcript if answered; otherwise a brief best-effort suggested answer (or null if you cannot suggest one).
- Order by appearance. Skip rhetorical filler ("you know?", "right?"). Max 25 questions.${langClause}
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
      return res.status(502).json({ error: 'LLM returned non-JSON', raw });
    }

    const questions = (Array.isArray(parsed.questions) ? parsed.questions : []).map((q) => ({
      question: String(q.question || '').trim(),
      askedBy: q.askedBy || null,
      answered: !!q.answered,
      answer: q.answer || null
    })).filter((q) => q.question);

    res.json({
      success: true,
      questions,
      openCount: questions.filter((q) => !q.answered).length,
      provider,
      model,
      usage
    });
  } catch (err) {
    next(err);
  }
});

export default router;
