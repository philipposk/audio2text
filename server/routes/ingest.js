// Ingest audio from a public URL (YouTube, Vimeo, direct media link) and
// hand it to the transcription pipeline. Uses youtube-dl-exec (yt-dlp wrapper).
//
// Security:
//   - Host allowlist (configurable via INGEST_ALLOWED_HOSTS) prevents SSRF.
//   - Only http/https URLs accepted.
//   - Downloaded file is deleted after transcription.
//
// Vercel note: yt-dlp binary is not present in serverless runtime — this route
// is intended for the self-hosted / long-running server. On Vercel it returns
// a clear error.

import express from 'express';
import youtubeDl from 'youtube-dl-exec';
import { UPLOADS_DIR } from '../utils/paths.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { transcribeAudio } from '../utils/transcription.js';
import { transcribeAudioLocal } from '../utils/localTranscription.js';
import { createJob } from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

const DEFAULT_ALLOWED = [
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
  'vimeo.com', 'www.vimeo.com',
  'soundcloud.com', 'www.soundcloud.com'
];

function getAllowedHosts() {
  const env = process.env.INGEST_ALLOWED_HOSTS;
  if (!env) return DEFAULT_ALLOWED;
  return env.split(',').map((h) => h.trim()).filter(Boolean);
}

function validateUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error('Invalid URL'), { status: 400 });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('Only http(s) URLs allowed'), { status: 400 });
  }
  const allowed = getAllowedHosts();
  if (!allowed.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) {
    throw Object.assign(
      new Error(`Host not in allowlist. Allowed: ${allowed.join(', ')}`),
      { status: 400 }
    );
  }
  return url;
}

/**
 * POST /api/ingest
 * Body: { url, task?, language?, word_timestamps?, prompt? }
 */
router.post('/', async (req, res, next) => {
  if (process.env.VERCEL) {
    return res.status(501).json({
      error: 'URL ingest unavailable on Vercel serverless (yt-dlp binary missing). Run the self-hosted server.'
    });
  }

  let downloadedPath;
  try {
    const { url, task, language, word_timestamps, prompt } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'Field "url" is required.' });
    }
    validateUrl(url);

    const tmpDir = UPLOADS_DIR;
    await fs.mkdir(tmpDir, { recursive: true });
    // Unique token per request so concurrent ingests never pick up each other's
    // downloaded file (a shared `ingest-<timestamp>` prefix + dir-glob would race).
    const reqToken = `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const outTemplate = join(tmpDir, `${reqToken}.%(ext)s`);

    console.log(`[ingest] downloading ${url}`);
    const info = await youtubeDl(url, {
      output: outTemplate,
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: 0,
      noPlaylist: true,
      noWarnings: true,
      // Print resolved filename to stdout so we can locate it deterministically.
      printJson: true
    });

    // Match ONLY this request's token, so a parallel ingest's file is invisible.
    const files = await fs.readdir(tmpDir);
    const match = files
      .filter((f) => f.startsWith(reqToken) && f.endsWith('.mp3'))
      .sort()
      .reverse();
    if (match.length === 0) {
      throw new Error('Ingest succeeded but no audio file found on disk.');
    }
    downloadedPath = join(tmpDir, match[0]);

    const useTask = task === 'translate' ? 'translate' : 'transcribe';
    // undefined/'auto' → Whisper auto-detects (see transcription util).
    const lang = language && language !== 'auto' ? language : undefined;
    const wantsWords = String(word_timestamps || 'false') === 'true';
    const granularities = wantsWords ? ['segment', 'word'] : ['segment'];

    let transcription;
    let method = 'openai';
    if (process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY) {
      try {
        transcription = await transcribeAudio(downloadedPath, {
          task: useTask,
          language: lang,
          prompt: prompt || '',
          response_format: 'verbose_json',
          timestamp_granularities: granularities
        });
        method = transcription.provider || method;
      } catch (err) {
        if (!/quota|billing|Connection/i.test(err.message || '')) throw err;
        method = 'local';
      }
    } else {
      method = 'local';
    }

    if (method === 'local') {
      if (useTask === 'translate') {
        return res.status(503).json({ error: 'Translate task requires OPENAI_API_KEY.' });
      }
      transcription = await transcribeAudioLocal(downloadedPath, { language: lang });
    }

    const job = await createJob({
      type: 'ingest',
      sourceName: info?.title || url,
      language: transcription.language || lang,
      task: useTask,
      method,
      duration: transcription.duration || info?.duration || null,
      text: transcription.text,
      segments: transcription.segments || [],
      meta: {
        sourceUrl: url,
        uploader: info?.uploader || null,
        webpageUrl: info?.webpage_url || null
      }
    });

    res.json({
      success: true,
      jobId: job.id,
      title: info?.title || null,
      duration: transcription.duration || info?.duration || null,
      transcription: transcription.text,
      segments: transcription.segments || [],
      language: transcription.language,
      task: useTask,
      method
    });
  } catch (error) {
    next(error);
  } finally {
    if (downloadedPath && fsSync.existsSync(downloadedPath)) {
      await fs.unlink(downloadedPath).catch(() => {});
    }
  }
});

router.get('/allowed-hosts', (req, res) => {
  res.json({ hosts: getAllowedHosts() });
});

export default router;
