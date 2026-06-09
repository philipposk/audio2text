// WebSocket live transcription.
//
// Protocol:
//   Client opens ws://host/api/live?language=el&task=transcribe
//   Client sends:
//     - Binary frames containing audio chunks (any container the browser MediaRecorder produces; we just buffer bytes)
//     - JSON text frame { "type": "flush" } to force an interim transcription of buffered audio
//     - JSON text frame { "type": "close" } to end the session
//   Server responds with JSON text frames:
//     - { "type": "partial", "text": "...", "duration": n }
//     - { "type": "error", "message": "..." }
//     - { "type": "final", "jobId": "...", "text": "...", "segments": [...] }
//
// Strategy: buffer audio bytes to disk. On flush, transcribe what we have
// (cheap with Groq Whisper if available, otherwise OpenAI). On close, persist
// the full transcription as a job. This is NOT true streaming ASR (Whisper
// isn't streaming-native), but it gives a good UX for short utterances.

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { transcribeAudio } from '../utils/transcription.js';
import { createJob } from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SESSION_DIR = join(__dirname, '../../uploads/live');

export function registerLiveWs(app) {
  if (typeof app.ws !== 'function') {
    console.warn('[live] express-ws not initialized; /api/live disabled');
    return;
  }

  app.ws('/api/live', async (ws, req) => {
    if (!process.env.OPENAI_API_KEY) {
      ws.send(JSON.stringify({ type: 'error', message: 'OPENAI_API_KEY required for live transcription' }));
      ws.close();
      return;
    }

    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const ext = (req.query.ext || 'webm').replace(/[^a-z0-9]/gi, '');
    const language = req.query.language || 'el';
    const task = req.query.task === 'translate' ? 'translate' : 'transcribe';
    await fsp.mkdir(SESSION_DIR, { recursive: true });
    const sessionPath = join(SESSION_DIR, `${sessionId}.${ext}`);
    const writeStream = fs.createWriteStream(sessionPath);

    let busy = false;
    let totalBytes = 0;
    console.log(`[live] session=${sessionId} lang=${language} task=${task} ext=${ext}`);

    const transcribeCurrent = async (isFinal) => {
      if (busy) return;
      busy = true;
      try {
        // Yield to the event loop so any pending writes hit disk before we
        // re-read the file for a Whisper request.
        await new Promise((resolve) => setImmediate(resolve));
        const result = await transcribeAudio(sessionPath, {
          task,
          language,
          response_format: 'verbose_json'
        });
        if (isFinal) {
          const job = await createJob({
            type: 'live',
            sourceName: `live-${sessionId}`,
            language: result.language || language,
            task,
            method: 'openai',
            duration: result.duration || null,
            text: result.text,
            segments: result.segments || [],
            meta: { sessionId }
          });
          ws.send(JSON.stringify({
            type: 'final',
            jobId: job.id,
            text: result.text,
            segments: result.segments || [],
            duration: result.duration || null
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'partial',
            text: result.text,
            duration: result.duration || null
          }));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      } finally {
        busy = false;
      }
    };

    ws.on('message', async (msg, isBinary) => {
      if (isBinary || Buffer.isBuffer(msg)) {
        writeStream.write(msg);
        totalBytes += msg.length;
        return;
      }
      const text = msg.toString();
      let parsed;
      try { parsed = JSON.parse(text); } catch { return; }
      if (parsed.type === 'flush') {
        if (totalBytes < 8 * 1024) {
          ws.send(JSON.stringify({ type: 'error', message: 'Not enough audio buffered yet' }));
          return;
        }
        await transcribeCurrent(false);
      } else if (parsed.type === 'close') {
        // Finalize BEFORE closing — ws.send() fails after close event fires
        writeStream.end();
        await new Promise((r) => writeStream.once('close', r));
        try {
          if (totalBytes > 8 * 1024) {
            await transcribeCurrent(true);
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Recording too short — speak for at least a few seconds' }));
          }
        } finally {
          ws.close();
        }
      }
    });

    ws.on('close', async () => {
      // Cleanup only — transcription is done in the 'close' message handler above
      await fsp.unlink(sessionPath).catch(() => {});
      console.log(`[live] session=${sessionId} closed bytes=${totalBytes}`);
    });

    ws.send(JSON.stringify({ type: 'ready', sessionId, language, task }));
  });
}
