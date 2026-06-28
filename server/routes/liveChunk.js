// HTTP-based live transcription — Vercel-compatible alternative to the
// WebSocket live route (Vercel serverless can't hold WebSocket connections).
//
// The client records short standalone clips (~5s) and POSTs each to /chunk;
// the server transcribes it and returns text+segments WITHOUT creating a job.
// When the user stops, the client POSTs the accumulated transcript to /finalize
// which persists ONE job for the whole session.
//
//   POST /api/live/chunk     (multipart: audio, language?, task?) -> { text, segments, duration, language, provider }
//   POST /api/live/finalize  (json: text, segments, language?, task?, duration?, sourceName?) -> { jobId }

import express from 'express';
import multer from 'multer';
import { UPLOADS_DIR } from '../utils/paths.js';
import fsp from 'fs/promises';
import { transcribeAudio } from '../utils/transcription.js';
import { createJob } from '../db/index.js';

const router = express.Router();

// Preserve a real audio extension on the temp file — Whisper infers the format
// from the filename and rejects extensionless uploads. MediaRecorder yields
// webm/ogg/mp4 depending on the browser.
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const mime = file.mimetype || '';
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
    cb(null, `live-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

router.post('/chunk', upload.single('audio'), async (req, res, next) => {
  let filePath;
  try {
    if (!req.file) return res.status(400).json({ error: 'audio clip required' });
    if (!process.env.OPENAI_API_KEY && !process.env.GROQ_API_KEY) {
      await fsp.unlink(req.file.path).catch(() => {});
      return res.status(503).json({ error: 'Set GROQ_API_KEY or OPENAI_API_KEY for live transcription' });
    }
    filePath = req.file.path;
    const task = req.body.task === 'translate' ? 'translate' : 'transcribe';
    const language = req.body.language && req.body.language !== 'auto' ? req.body.language : undefined;

    const r = await transcribeAudio(filePath, {
      task,
      language,
      response_format: 'verbose_json',
      timestamp_granularities: ['segment']
    });

    res.json({
      text: r.text || '',
      segments: r.segments || [],
      duration: r.duration || 0,
      language: r.language || language || null,
      provider: r.provider || null
    });
  } catch (err) {
    next(err);
  } finally {
    if (filePath) await fsp.unlink(filePath).catch(() => {});
  }
});

router.post('/finalize', async (req, res, next) => {
  try {
    const { text = '', segments = [], language, task = 'transcribe', duration = 0, sourceName } = req.body || {};
    if (!String(text).trim() && (!Array.isArray(segments) || segments.length === 0)) {
      return res.status(400).json({ error: 'Nothing to save — empty transcript' });
    }
    const job = await createJob({
      type: 'live',
      sourceName: sourceName || 'Live recording',
      language: language || null,
      task: task === 'translate' ? 'translate' : 'transcribe',
      method: 'live',
      duration: Number(duration) || 0,
      text: String(text),
      segments: Array.isArray(segments) ? segments : [],
      meta: { live: true, transport: 'http' }
    });
    res.json({ success: true, jobId: job.id });
  } catch (err) {
    next(err);
  }
});

export default router;
