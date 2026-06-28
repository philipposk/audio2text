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

// How far on either side of a target cut we'll look for a silence to snap to.
// 45s window vs a 25-min chunk means worst case a chunk is 25min±45s — well
// within Whisper's size cap — but cuts land in gaps, not mid-word.
const SILENCE_WINDOW_SEC = 45;

/**
 * Detect silence intervals via ffmpeg's silencedetect filter. Returns an array
 * of { start, end } in seconds. Best-effort: resolves [] if ffmpeg can't probe
 * (so callers fall back to fixed-time cuts). noiseDb is the threshold below
 * which audio counts as silence; minSilenceSec is the minimum gap length.
 */
export async function detectSilences(filePath, { noiseDb = -30, minSilenceSec = 0.4 } = {}) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, [
      '-i', filePath,
      '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilenceSec}`,
      '-f', 'null', '-'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', () => resolve([]));
    proc.on('close', () => {
      const silences = [];
      let pendingStart = null;
      for (const line of stderr.split('\n')) {
        const s = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
        if (s) { pendingStart = parseFloat(s[1]); continue; }
        const e = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
        if (e && pendingStart !== null) {
          silences.push({ start: Math.max(0, pendingStart), end: parseFloat(e[1]) });
          pendingStart = null;
        }
      }
      resolve(silences);
    });
  });
}

/**
 * Pick cut points so each chunk is ~chunkSeconds but boundaries land inside a
 * silence whenever one exists within ±window of the ideal cut. Pure function —
 * unit-tested without ffmpeg. Returns ascending, de-duplicated cut times (the
 * boundaries between chunks; does NOT include 0 or duration).
 */
export function computeCutPoints(duration, silences, chunkSeconds = CHUNK_SECONDS, window = SILENCE_WINDOW_SEC) {
  if (!duration || duration <= chunkSeconds) return [];
  const mids = (silences || [])
    .map((s) => (s.start + s.end) / 2)
    .filter((m) => Number.isFinite(m));
  const cuts = [];
  let target = chunkSeconds;
  let last = 0;
  while (target < duration - 1) {
    // nearest silence midpoint to this target, within the window and strictly
    // after the previous cut (so chunks never collapse to zero length).
    let best = null;
    let bestDist = Infinity;
    for (const m of mids) {
      if (m <= last + 1 || m >= duration - 1) continue;
      const dist = Math.abs(m - target);
      if (dist <= window && dist < bestDist) { best = m; bestDist = dist; }
    }
    const cut = best !== null ? best : target;
    if (cut > last + 1) {
      cuts.push(Math.round(cut * 1000) / 1000);
      last = cut;
    }
    // advance from the actual cut so a snapped-back boundary doesn't shrink the
    // following chunk below ~chunkSeconds.
    target = last + chunkSeconds;
  }
  return cuts;
}

/**
 * Split filePath into ordered chunks. Returns { chunks: [{ path, startSec }], cleanup }.
 * Caller must invoke cleanup() once chunks are no longer needed.
 *
 * By default cuts are snapped to silences (VAD-style) so words aren't split
 * across chunk boundaries. Pass { smart: false } to force fixed-time cuts.
 */
export async function splitAudio(filePath, { chunkSeconds = CHUNK_SECONDS, smart = true } = {}) {
  const tmpDir = join(dirname(filePath), `chunks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  const ext = '.mp3';
  const stem = basename(filePath, extname(filePath));
  const pattern = join(tmpDir, `${stem}-%03d${ext}`);

  // Try silence-aware cut points; fall back to fixed-interval segmenting if
  // probing fails or finds no usable gaps.
  let cutPoints = [];
  if (smart) {
    try {
      const [duration, silences] = await Promise.all([
        probeDuration(filePath),
        detectSilences(filePath)
      ]);
      if (duration) cutPoints = computeCutPoints(duration, silences, chunkSeconds);
    } catch { cutPoints = []; }
  }

  const segmentArgs = cutPoints.length
    ? ['-segment_times', cutPoints.join(',')]
    : ['-segment_time', String(chunkSeconds)];

  await run(ffmpegPath, [
    '-y',
    '-i', filePath,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-b:a', `${TARGET_BITRATE_KBPS}k`,
    '-f', 'segment',
    ...segmentArgs,
    '-reset_timestamps', '1',
    pattern
  ]);

  const files = (await fsp.readdir(tmpDir)).filter((f) => f.endsWith(ext)).sort();
  // With non-uniform silence cuts, each chunk's absolute start is the previous
  // cut point (0 for the first); with fixed cuts it's i*chunkSeconds.
  const starts = cutPoints.length ? [0, ...cutPoints] : files.map((_, i) => i * chunkSeconds);
  const chunks = files.map((name, i) => ({
    path: join(tmpDir, name),
    startSec: starts[i] ?? i * chunkSeconds
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
