// POST /api/transcribe/batch
// Multi-file upload, sequential processing (bounded concurrency 2) to keep
// memory + API rate predictable. Returns an array of { file, jobId, ... }
// preserving input order.

import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { transcribeAudio } from '../utils/transcription.js';
import { transcribeAudioLocal } from '../utils/localTranscription.js';
import { needsChunking, splitAudio, mergeTranscriptions } from '../utils/audioChunk.js';
import { createJob } from '../db/index.js';
import { chargeUsage } from '../middleware/apiKey.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

const upload = multer({
  dest: join(__dirname, '../../uploads'),
  limits: { fileSize: 100 * 1024 * 1024, files: 25 }
});

const CONCURRENCY = parseInt(process.env.BATCH_CONCURRENCY || '2', 10);

async function processOne(file, opts, req) {
  const filePath = file.path;
  try {
    const { task, language, prompt, granularities } = opts;
    let transcription;
    let method = 'openai';
    if (process.env.OPENAI_API_KEY) {
      try {
        if (await needsChunking(filePath)) {
          const { chunks, cleanup } = await splitAudio(filePath);
          try {
            const parts = [];
            for (const c of chunks) {
              const r = await transcribeAudio(c.path, {
                task, language, prompt,
                response_format: 'verbose_json',
                timestamp_granularities: granularities
              });
              parts.push({ result: r, startSec: c.startSec });
            }
            transcription = mergeTranscriptions(parts);
          } finally { await cleanup(); }
        } else {
          transcription = await transcribeAudio(filePath, {
            task, language, prompt,
            response_format: 'verbose_json',
            timestamp_granularities: granularities
          });
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
    const language = req.body.language || 'el';
    const prompt = req.body.prompt || '';
    const wantsWords = String(req.body.word_timestamps || 'false') === 'true';
    const granularities = wantsWords ? ['segment', 'word'] : ['segment'];
    const opts = { task, language, prompt, granularities };

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
