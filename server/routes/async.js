// Async transcription. Mirror of /api/transcribe but returns immediately with
// a task id; the actual transcription runs on the in-process queue. Caller
// either polls GET /api/tasks/:id or supplies a callbackUrl.

import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { transcribeAudio } from '../utils/transcription.js';
import { transcribeAudioLocal } from '../utils/localTranscription.js';
import { needsChunking, splitAudio, mergeTranscriptions } from '../utils/audioChunk.js';
import { createJob } from '../db/index.js';
import { enqueue, getTask, listTasks } from '../utils/queue.js';
import { chargeUsage } from '../middleware/apiKey.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();
const upload = multer({
  dest: join(__dirname, '../../uploads'),
  limits: { fileSize: 200 * 1024 * 1024 }
});

router.post('/transcribe', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'audio file required' });
    const filePath = req.file.path;
    const task = req.body.task === 'translate' ? 'translate' : 'transcribe';
    const language = req.body.language || 'el';
    const prompt = req.body.prompt || '';
    const wantsWords = String(req.body.word_timestamps || 'false') === 'true';
    const granularities = wantsWords ? ['segment', 'word'] : ['segment'];
    const callbackUrl = req.body.callbackUrl || null;

    const apiKey = req.apiKey;

    const taskId = enqueue(async () => {
      try {
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
          if (task === 'translate') throw new Error('Translate task requires OPENAI_API_KEY');
          transcription = await transcribeAudioLocal(filePath, { language });
        }

        const job = await createJob({
          type: 'transcription',
          sourceName: req.file.originalname,
          language: transcription.language || language,
          task,
          method,
          duration: transcription.duration || null,
          text: transcription.text,
          segments: transcription.segments || [],
          meta: { async: true }
        });

        if (apiKey) {
          await chargeUsage({ apiKey }, transcription.duration || 0, '/api/tasks/transcribe');
        }
        return { jobId: job.id, language: transcription.language, duration: transcription.duration, task, method };
      } finally {
        await fs.unlink(filePath).catch(() => {});
      }
    }, { callbackUrl, label: `transcribe:${req.file.originalname}` });

    res.status(202).json({ taskId, status: 'pending', poll: `/api/tasks/${taskId}` });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res) => {
  const t = getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  res.json({ task: t });
});

router.get('/', (req, res) => {
  res.json({ tasks: listTasks() });
});

export default router;
