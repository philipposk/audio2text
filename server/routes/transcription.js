import express from 'express';
import multer from 'multer';
import { transcribeAudio } from '../utils/transcription.js';
import { transcribeAudioLocal } from '../utils/localTranscription.js';
import { createJob } from '../db/index.js';
import { needsChunking, splitAudio, mergeTranscriptions } from '../utils/audioChunk.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = join(__dirname, '../../uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    // Strip any path separators / traversal sequences from the client-supplied
    // name before it becomes part of a real path. multer joins this onto the
    // upload dir verbatim, so an originalname like "../../x" must be neutralized.
    const safeName = file.originalname.replace(/[/\\]/g, '_').replace(/\.{2,}/g, '_').slice(0, 180);
    cb(null, uniqueSuffix + '-' + safeName);
  }
});

const AUDIO_MIME = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
  'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
  'audio/flac', 'audio/ogg', 'audio/webm', 'audio/amr',
  'audio/3gpp', 'audio/aac', 'audio/x-aac'
]);

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (AUDIO_MIME.has(file.mimetype) ||
        file.originalname.match(/\.(mp3|wav|m4a|flac|ogg|webm|amr|3gp|aac|mp4)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  }
});

/**
 * POST /api/transcribe
 * Multipart form-data:
 *   audio               (file, required)
 *   language            (string, default 'el') — source language for transcribe task
 *   task                ('transcribe' | 'translate', default 'transcribe')
 *                       'translate' uses Whisper's English-output mode.
 *   prompt              (string, optional)    — vocabulary hint
 *   word_timestamps     ('true' | 'false')    — include word-level granularity
 */
router.post('/', upload.single('audio'), async (req, res, next) => {
  let filePath;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }
    filePath = req.file.path;

    const task = req.body.task === 'translate' ? 'translate' : 'transcribe';
    // Default to auto-detect (undefined) rather than forcing a language; the util
    // omits the param so Whisper detects. 'auto' from the client is also honored.
    const language = req.body.language && req.body.language !== 'auto' ? req.body.language : undefined;
    const wantsWords = String(req.body.word_timestamps || 'false') === 'true';
    const granularities = wantsWords ? ['segment', 'word'] : ['segment'];

    console.log(`[transcribe] file=${req.file.filename} task=${task} lang=${language}`);

    let transcription;
    let method = 'openai';

    if (process.env.OPENAI_API_KEY) {
      try {
        const big = await needsChunking(filePath);
        if (big) {
          console.log('[transcribe] file exceeds 24MB — chunking via ffmpeg');
          const { chunks, cleanup } = await splitAudio(filePath);
          try {
            const parts = [];
            for (const chunk of chunks) {
              const result = await transcribeAudio(chunk.path, {
                task,
                language,
                prompt: req.body.prompt || '',
                response_format: 'verbose_json',
                timestamp_granularities: granularities
              });
              parts.push({ result, startSec: chunk.startSec });
            }
            transcription = mergeTranscriptions(parts);
          } finally {
            await cleanup();
          }
        } else {
          transcription = await transcribeAudio(filePath, {
            task,
            language,
            prompt: req.body.prompt || '',
            response_format: 'verbose_json',
            timestamp_granularities: granularities
          });
        }
      } catch (err) {
        const recoverable = /quota|billing|exceeded|Connection/i.test(err.message || '');
        if (!recoverable) throw err;
        console.log('[transcribe] OpenAI failed, falling back to local Whisper');
        method = 'local';
      }
    } else {
      method = 'local';
    }

    if (method === 'local') {
      // Local fallback does not support translate task — warn caller.
      if (task === 'translate') {
        return res.status(503).json({
          error: 'Translate task requires OPENAI_API_KEY (local Whisper fallback does not support audio→English translation in this build).'
        });
      }
      transcription = await transcribeAudioLocal(filePath, { language });
    }

    await fs.unlink(filePath).catch(() => {});
    filePath = null;

    const job = await createJob({
      type: 'transcription',
      sourceName: req.file.originalname,
      language: transcription.language || language,
      task,
      method,
      duration: transcription.duration || null,
      text: transcription.text,
      segments: transcription.segments || [],
      meta: { words: transcription.words || null }
    });

    res.json({
      success: true,
      jobId: job.id,
      transcription: transcription.text,
      segments: transcription.segments || [],
      words: transcription.words || [],
      language: transcription.language,
      duration: transcription.duration,
      task,
      method
    });
  } catch (error) {
    if (filePath) await fs.unlink(filePath).catch(() => {});
    next(error);
  }
});

router.get('/status/:id', (req, res) => {
  // Placeholder for async transcription status (future queue worker).
  res.json({ status: 'completed' });
});

export default router;
