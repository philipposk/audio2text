// Public, unauthenticated read-only access to a shared transcript.
// Mounted BEFORE the API-key middleware so a recipient needs no account/key.
// Deliberately exposes only transcript content — never the source filename,
// speaker metadata, audio, or any other potentially-identifying fields.

import express from 'express';
import { getJobByShareToken } from '../db/index.js';

const router = express.Router();

router.get('/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    if (token.length < 8) return res.status(404).json({ error: 'Not found' });
    const job = await getJobByShareToken(token);
    if (!job) return res.status(404).json({ error: 'Shared transcript not found or sharing was disabled' });

    // Whitelist fields — no sourceName, no meta, no audio.
    res.json({
      shared: true,
      language: job.language || null,
      task: job.task || null,
      duration: job.duration || null,
      createdAt: job.createdAt || null,
      text: job.text || '',
      segments: (job.segments || []).map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        ...(s.speaker ? { speaker: s.speaker } : {}),
      })),
    });
  } catch (e) { next(e); }
});

export default router;
