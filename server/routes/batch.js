// POST /api/transcribe/batch
// Multi-file upload, sequential processing (bounded concurrency 2) to keep
// memory + API rate predictable. Returns an array of { file, jobId, ... }
// preserving input order.

import express from 'express';
import multer from 'multer';
import { UPLOADS_DIR } from '../utils/paths.js';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { transcribeAudio } from '../utils/transcription.js';
import { transcribeAudioLocal } from '../utils/localTranscription.js';
import { needsChunking, splitAudio, mergeTranscriptions } from '../utils/audioChunk.js';
import { createJob } from '../db/index.js';
import { chargeUsage } from '../middleware/apiKey.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Preserve the original extension in the temp filename — OpenAI Whisper infers
// the audio format from it, and rejects extensionless files ("Unrecognized file
// format"). multer's bare `dest` strips the extension, so use diskStorage.
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safe = file.originalname.replace(/[/\\]/g, '_').replace(/\.{2,}/g, '_').slice(0, 180);
    cb(null, `${suffix}-${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024, files: 25 }
});

const CONCURRENCY = parseInt(process.env.BATCH_CONCURRENCY || '2', 10);

async function processOne(file, opts, req) {
  const filePath = file.path;
  try {
    const { task, language, prompt, granularities, quality } = opts;
    let transcription;
    let method = 'openai';
    if (process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY) {
      try {
        if (await needsChunking(filePath)) {
          const { chunks, cleanup } = await splitAudio(filePath);
          try {
            const parts = [];
            let carry = ''; // feed previous chunk's tail forward for term consistency
            for (const c of chunks) {
              const chunkPrompt = [prompt, carry].filter(Boolean).join(' ').slice(-880);
              const r = await transcribeAudio(c.path, {
                task, language, prompt: chunkPrompt, quality,
                response_format: 'verbose_json',
                timestamp_granularities: granularities
              });
              parts.push({ result: r, startSec: c.startSec });
              carry = (r.text || '').slice(-700);
              method = r.provider || method;
            }
            transcription = mergeTranscriptions(parts);
          } finally { await cleanup(); }
        } else {
          transcription = await transcribeAudio(filePath, {
            task, language, prompt, quality,
            response_format: 'verbose_json',
            timestamp_granularities: granularities
          });
          method = transcription.provider || method;
        }
      } catch (err) {
        if (!/quota|billing|Connection/i.test(err.message || '')) throw err;
        method = 'local';
      }
    } else {
      method = 'local';
    }
    if (method === 'local') {
      if (task === 'translate') {
        throw new Error('Translate task requires OPENAI_API_KEY (local fallback unsupported)');
      }
      transcription = await transcribeAudioLocal(filePath, { language });
    }

    const job = await createJob({
      type: 'transcription',
      sourceName: file.originalname,
      language: transcription.language || language,
      task,
      method,
      duration: transcription.duration || null,
      text: transcription.text,
      segments: transcription.segments || [],
      meta: { batch: true }
    });

    await chargeUsage(req, transcription.duration || 0, '/api/transcribe/batch');

    return {
      file: file.originalname,
      jobId: job.id,
      language: transcription.language,
      duration: transcription.duration,
      task,
      method,
      preview: (transcription.text || '').slice(0, 200)
    };
  } catch (err) {
    return { file: file.originalname, error: err.message };
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
}

router.post('/', upload.array('audio', 25), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'Upload one or more files under "audio" field.' });
    }
    const task = req.body.task === 'translate' ? 'translate' : 'transcribe';
    // Auto-detect by default (undefined) — the util omits the param; 'auto' too.
    const language = req.body.language && req.body.language !== 'auto' ? req.body.language : undefined;
    const prompt = req.body.prompt || '';
    const wantsWords = String(req.body.word_timestamps || 'false') === 'true';
    const granularities = wantsWords ? ['segment', 'word'] : ['segment'];
    const quality = req.body.quality === 'accurate' ? 'accurate' : 'fast';
    const opts = { task, language, prompt, granularities, quality };

    const results = new Array(files.length);
    let cursor = 0;
    async function worker() {
      while (cursor < files.length) {
        const idx = cursor++;
        results[idx] = await processOne(files[idx], opts, req);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

    const ok = results.filter((r) => r.jobId).length;
    const failed = results.length - ok;
    res.json({ success: true, total: results.length, ok, failed, results });
  } catch (err) {
    next(err);
  }
});

export default router;
