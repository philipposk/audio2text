// POST /api/diarize — speaker diarization.
//
// Backed by Replicate (cheap, no GPU on our side). The default model is
// `thomasmol/whisper-diarization` which returns segments with speaker IDs and
// transcripts in one call, so this endpoint can also act as a transcription
// alternative when diarization is desired.
//
// Required env:
//   REPLICATE_API_TOKEN  — get one at https://replicate.com/account/api-tokens
// Optional env:
//   REPLICATE_DIARIZE_MODEL — full "owner/name:version" string to override the default
//
// Body (multipart/form-data OR JSON):
//   audio (file, multipart) OR audioUrl (string, JSON) — one is required
//   numSpeakers (int, optional)
//   language    (string, optional ISO code)

import express from 'express';
import multer from 'multer';
import fsp from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createJob } from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

const upload = multer({
  dest: join(__dirname, '../../uploads'),
  limits: { fileSize: 100 * 1024 * 1024 }
});

const DEFAULT_MODEL =
  process.env.REPLICATE_DIARIZE_MODEL ||
  'thomasmol/whisper-diarization:cbd15da9f839c5f932742f86ce7def3a03c22e2b4171d42823e83e314547003f';

const REPLICATE_BASE = 'https://api.replicate.com/v1';

async function replicateRun({ model, input, token }) {
  const [, version] = model.includes(':') ? model.split(':') : [model, undefined];
  const body = version ? { version, input } : { input };
  const createRes = await fetch(`${REPLICATE_BASE}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=60'
    },
    body: JSON.stringify(body)
  });
  if (!createRes.ok) {
    const txt = await createRes.text();
    throw Object.assign(new Error(`Replicate error: ${createRes.status} ${txt.slice(0, 300)}`), {
      status: 502
    });
  }
  let pred = await createRes.json();

  // Poll if Replicate didn't return a terminal status within the Prefer-wait window.
  const terminal = new Set(['succeeded', 'failed', 'canceled']);
  let attempts = 0;
  while (!terminal.has(pred.status) && attempts < 60) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await fetch(`${REPLICATE_BASE}/predictions/${pred.id}`, {
      headers: { Authorization: `Token ${token}` }
    });
    pred = await r.json();
    attempts++;
  }
  if (pred.status !== 'succeeded') {
    throw Object.assign(new Error(`Replicate prediction ${pred.status}: ${pred.error || 'unknown'}`), {
      status: 502
    });
  }
  return pred.output;
}

// Normalize Replicate output into our segment format: [{ start, end, speaker, text }]
function normalizeOutput(output) {
  if (!output) return [];
  // thomasmol/whisper-diarization returns { segments: [{ start, end, speaker, text, words }] }
  if (Array.isArray(output.segments)) {
    return output.segments.map((s) => ({
      start: s.start ?? 0,
      end: s.end ?? 0,
      speaker: s.speaker ?? null,
      text: s.text ?? '',
      words: s.words ?? []
    }));
  }
  // Some pyannote-only models return [{ start, end, speaker }] without text.
  if (Array.isArray(output)) {
    return output.map((s) => ({
      start: s.start ?? 0,
      end: s.end ?? 0,
      speaker: s.speaker ?? null,
      text: s.text ?? ''
    }));
  }
  return [];
}

router.post('/', upload.single('audio'), async (req, res, next) => {
  let filePath;
  try {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return res.status(501).json({
        error: 'Diarization disabled. Set REPLICATE_API_TOKEN env var to enable.'
      });
    }

    const audioUrl = req.body.audioUrl;
    if (!req.file && !audioUrl) {
      return res.status(400).json({ error: 'audio file or audioUrl is required' });
    }

    // Replicate needs the audio as a URL or a base64 data URI. For uploads we
    // inline the file as a data URI (base64 adds ~33%, so guard the raw size).
    let fileInput = audioUrl;
    let sourceName = audioUrl;
    const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
    if (req.file && !audioUrl) {
      filePath = req.file.path;
      if (req.file.size > MAX_UPLOAD_BYTES) {
        await fsp.unlink(filePath).catch(() => {});
        return res.status(413).json({
          error: `File too large for inline diarization (${(req.file.size / 1048576).toFixed(1)}MB > 40MB). Pass a public audioUrl instead.`
        });
      }
      const buf = await fsp.readFile(filePath);
      const mime = req.file.mimetype || 'audio/mpeg';
      fileInput = `data:${mime};base64,${buf.toString('base64')}`;
      sourceName = req.file.originalname || 'upload';
    }

    const input = { file: fileInput };
    if (req.body.numSpeakers) input.num_speakers = parseInt(req.body.numSpeakers, 10);
    if (req.body.language) input.language = req.body.language;

    console.log(`[diarize] running ${DEFAULT_MODEL} on ${req.file ? `upload:${sourceName}` : audioUrl}`);
    const output = await replicateRun({ model: DEFAULT_MODEL, input, token });
    const segments = normalizeOutput(output);
    // Free the temp upload once it has been sent to Replicate.
    if (filePath) { await fsp.unlink(filePath).catch(() => {}); filePath = null; }

    const text = segments.map((s) => (s.speaker ? `[${s.speaker}] ${s.text}` : s.text)).join('\n');

    const job = await createJob({
      type: 'diarization',
      sourceName,
      language: req.body.language || null,
      task: 'diarize',
      method: 'replicate',
      duration: segments.length ? segments[segments.length - 1].end : null,
      text,
      segments,
      meta: { model: DEFAULT_MODEL, source: sourceName, speakers: Array.from(new Set(segments.map((s) => s.speaker).filter(Boolean))) }
    });

    res.json({
      success: true,
      jobId: job.id,
      speakers: job.meta.speakers,
      segments,
      method: 'replicate'
    });
  } catch (err) {
    if (filePath) await fsp.unlink(filePath).catch(() => {});
    next(err);
  }
});

router.get('/info', (req, res) => {
  res.json({
    enabled: !!process.env.REPLICATE_API_TOKEN,
    model: DEFAULT_MODEL,
    notes: 'Accepts a file upload (≤40MB, sent to Replicate as a base64 data URI) or a public audioUrl.'
  });
});

export default router;
