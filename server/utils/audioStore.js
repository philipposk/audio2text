// Persistent storage for source audio so the UI can play a transcript back.
//
// Self-hosted only: files live on local disk under uploads/audio/. On Vercel the
// filesystem is ephemeral, so playback simply won't find the file there — the
// frontend treats a 404 as "no audio available" and hides the player.

import fs from 'fs';
import fsp from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = join(__dirname, '../../uploads/audio');

const MIME_BY_EXT = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4',
  '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.webm': 'audio/webm', '.aac': 'audio/aac', '.amr': 'audio/amr',
};

export function mimeForExt(ext) {
  return MIME_BY_EXT[String(ext).toLowerCase()] || 'application/octet-stream';
}

// Move a freshly-uploaded/downloaded temp file into the persistent audio store,
// keyed by job id. Returns { file, mime } to record on the job's meta, or null
// on failure (audio playback is best-effort and must never break transcription).
export async function persistAudio(jobId, srcPath, originalName = '') {
  try {
    await fsp.mkdir(AUDIO_DIR, { recursive: true });
    const ext = (extname(originalName) || extname(srcPath) || '.mp3').toLowerCase();
    const safeExt = /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '.mp3';
    const file = `${jobId}${safeExt}`;
    const dest = join(AUDIO_DIR, file);
    // rename across same filesystem; fall back to copy if it fails (e.g. /tmp).
    try {
      await fsp.rename(srcPath, dest);
    } catch {
      await fsp.copyFile(srcPath, dest);
      await fsp.unlink(srcPath).catch(() => {});
    }
    return { file, mime: mimeForExt(safeExt) };
  } catch {
    return null;
  }
}

export function audioFilePath(file) {
  // Guard against traversal — only a bare filename is ever valid here.
  const safe = String(file).replace(/[/\\]/g, '');
  return join(AUDIO_DIR, safe);
}

export async function removeAudio(file) {
  if (!file) return;
  await fsp.unlink(audioFilePath(file)).catch(() => {});
}

// Stream a file with HTTP range support so the browser can seek without
// downloading the whole thing.
export function streamAudio(req, res, absPath, mime) {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return res.status(404).json({ error: 'Audio not available for this job' });
  }
  const range = req.headers.range;
  res.setHeader('Content-Type', mime || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (start >= stat.size || end >= stat.size || start > end) {
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', end - start + 1);
    return fs.createReadStream(absPath, { start, end }).pipe(res);
  }
  res.setHeader('Content-Length', stat.size);
  return fs.createReadStream(absPath).pipe(res);
}
