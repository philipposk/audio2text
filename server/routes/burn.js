// POST /api/burn — hardcode subtitles into a video using ffmpeg.
//
// Multipart fields:
//   video  (file, required)       — MP4/MOV/MKV/WEBM
//   jobId  (string, optional)     — pulls segments from stored job
//   srt    (string, optional)     — raw SRT body (used when no jobId)
//   style  (string, optional)     — ffmpeg `force_style=` value (e.g. "FontSize=24,PrimaryColour=&H00FFFFFF&")
//
// Returns the burned MP4 as a download.

import express from 'express';
import multer from 'multer';
import { UPLOADS_DIR, TEMP_DIR } from '../utils/paths.js';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs/promises';
import fsSync from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { getJob } from '../db/index.js';
import { _internal as exportInternal } from './export.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 500 * 1024 * 1024 } // videos can be big
});

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`));
    });
  });
}

router.post('/', upload.single('video'), async (req, res, next) => {
  let videoPath, srtPath, outputPath;
  try {
    if (!req.file) return res.status(400).json({ error: 'video file required' });
    videoPath = req.file.path;

    let srtText = req.body?.srt;
    if (!srtText && req.body?.jobId) {
      const job = await getJob(req.body.jobId);
      if (!job) return res.status(404).json({ error: 'jobId not found' });
      if (!job.segments || job.segments.length === 0) {
        return res.status(400).json({ error: 'Job has no segments' });
      }
      srtText = exportInternal.toSrt(job.segments);
    }
    if (!srtText) {
      return res.status(400).json({ error: 'Provide srt or jobId' });
    }

    const tmpDir = TEMP_DIR;
    await fs.mkdir(tmpDir, { recursive: true });
    srtPath = join(tmpDir, `burn-${Date.now()}.srt`);
    outputPath = join(tmpDir, `burn-${Date.now()}.mp4`);
    await fs.writeFile(srtPath, srtText, 'utf-8');

    // ffmpeg subtitles filter needs special escaping for the path.
    const escapedSrt = srtPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
    const style = req.body?.style ? `:force_style='${req.body.style}'` : '';
    const filter = `subtitles='${escapedSrt}'${style}`;

    await runFfmpeg([
      '-y',
      '-i', videoPath,
      '-vf', filter,
      '-c:a', 'copy',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      outputPath
    ]);

    const downloadName = basename(req.file.originalname, /\.[^.]+$/.exec(req.file.originalname)?.[0] || '') + '-subbed.mp4';
    res.setHeader('Content-Type', 'video/mp4');
    res.download(outputPath, downloadName, async (err) => {
      if (err) console.error('[burn] download error', err);
      setTimeout(() => {
        fs.unlink(outputPath).catch(() => {});
        fs.unlink(srtPath).catch(() => {});
      }, 5000);
    });
  } catch (err) {
    next(err);
  } finally {
    if (videoPath && fsSync.existsSync(videoPath)) {
      await fs.unlink(videoPath).catch(() => {});
    }
  }
});

export default router;
