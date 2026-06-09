// Split large audio files into Whisper-safe chunks (~24MB each).
//
// OpenAI's /audio/transcriptions endpoint enforces a 25MB upload limit.
// For long recordings we re-encode to a constant bitrate, then segment by
// duration so each piece stays under the cap. Segments are transcribed
// independently and their timestamps are stitched back using the cumulative
// offset of each chunk.

import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import fsp from 'fs/promises';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Soft size threshold we route audio through chunking. 24MB leaves headroom
// vs the 25MB API limit for headers + base64 envelopes.
export const CHUNK_THRESHOLD_BYTES = 24 * 1024 * 1024;

// Re-encode bitrate (kbps). 64 kbps mono MP3 is plenty for ASR and gives ~480KB/min,
// so a 25-minute chunk fits well under the limit.
const TARGET_BITRATE_KBPS = 64;
const CHUNK_SECONDS = 25 * 60;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/**
 * Probe duration in seconds. Uses ffmpeg itself (no ffprobe binary required).
 */
export async function probeDuration(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-i', filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) return resolve(null);
      const [, h, m, s] = match;
      resolve(parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s));
    });
  });
}

/**
 * Split filePath into ordered chunks. Returns { chunks: [{ path, startSec }], cleanup }.
 * Caller must invoke cleanup() once chunks are no longer needed.
 */
export async function splitAudio(filePath, { chunkSeconds = CHUNK_SECONDS } = {}) {
  const tmpDir = join(dirname(filePath), `chunks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  const ext = '.mp3';
  const stem = basename(filePath, extname(filePath));
  const pattern = join(tmpDir, `${stem}-%03d${ext}`);

  await run(ffmpegPath, [
    '-y',
    '-i', filePath,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-b:a', `${TARGET_BITRATE_KBPS}k`,
    '-f', 'segment',
    '-segment_time', String(chunkSeconds),
    '-reset_timestamps', '1',
    pattern
  ]);

  const files = (await fsp.readdir(tmpDir)).filter((f) => f.endsWith(ext)).sort();
  const chunks = files.map((name, i) => ({
    path: join(tmpDir, name),
    startSec: i * chunkSeconds
  }));

  const cleanup = async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  };
  return { chunks, cleanup };
}

/**
 * Merge an array of Whisper verbose_json responses into a single response,
 * offsetting segment/word timestamps by each chunk's start time.
 */
export function mergeTranscriptions(parts) {
  const segments = [];
  const words = [];
  const texts = [];
  let totalDuration = 0;
  let language = null;

  for (const { result, startSec } of parts) {
    if (!language && result.language) language = result.language;
    texts.push(result.text || '');
    for (const seg of result.segments || []) {
      segments.push({
        ...seg,
        start: (seg.start || 0) + startSec,
        end: (seg.end || 0) + startSec
      });
    }
    for (const w of result.words || []) {
      words.push({
        ...w,
        start: (w.start || 0) + startSec,
        end: (w.end || 0) + startSec
      });
    }
    totalDuration = Math.max(totalDuration, startSec + (result.duration || 0));
  }

  return {
    text: texts.join(' ').trim(),
    segments,
    words,
    duration: totalDuration,
    language
  };
}

/**
 * Returns true if the file should be chunked before being sent to Whisper.
 */
export async function needsChunking(filePath) {
  const stat = await fsp.stat(filePath);
  return stat.size > CHUNK_THRESHOLD_BYTES;
}

export const _internal = { run };
