// Export transcription to txt/docx/pdf/json/srt/vtt.
// SRT/VTT now use real segment timestamps (with optional translation overlay)
// instead of a single 0:00-0:10 placeholder.

import express from 'express';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getJob } from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// ---------- subtitle helpers ----------

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

function formatTimestamp(seconds, sep = ',') {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalS = Math.floor(totalMs / 1000);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60) % 60;
  const h = Math.floor(totalS / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms, 3)}`;
}

function toSrt(segments) {
  return segments
    .map((seg, i) => {
      const text = (seg.translatedText || seg.text || '').trim();
      return `${i + 1}\n${formatTimestamp(seg.start, ',')} --> ${formatTimestamp(seg.end, ',')}\n${text}\n`;
    })
    .join('\n');
}

function toVtt(segments) {
  const body = segments
    .map((seg) => {
      const text = (seg.translatedText || seg.text || '').trim();
      return `${formatTimestamp(seg.start, '.')} --> ${formatTimestamp(seg.end, '.')}\n${text}\n`;
    })
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

// Fallback when caller provided plain text only — single block at 0:00.
function fakeSegmentFromText(text) {
  return [{ start: 0, end: 10, text }];
}

// ---------- main route ----------

/**
 * POST /api/export/:format
 * Body:
 *   transcription (string, required for txt/docx/pdf/json)
 *   segments      (array, preferred for srt/vtt)
 *   jobId         (string, optional — resolves transcription+segments from store)
 *   title         (string, optional)
 *   translatedSegments (array, optional — overrides segment text for subtitles)
 */
router.post('/:format', async (req, res, next) => {
  try {
    const { format } = req.params;
    let { transcription, segments, title = 'Transcription', jobId, translatedSegments } = req.body || {};

    if (jobId) {
      const job = await getJob(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      transcription = transcription || job.text;
      segments = segments || job.segments;
    }

    if (!transcription && (!segments || segments.length === 0)) {
      return res.status(400).json({ error: 'transcription or segments required' });
    }

    // Merge translation overlays onto segments if provided.
    if (Array.isArray(translatedSegments) && Array.isArray(segments)) {
      segments = segments.map((s, i) => ({
        ...s,
        translatedText: translatedSegments[i] || s.text
      }));
    }

    const tempDir = join(__dirname, '../../temp');
    await fs.mkdir(tempDir, { recursive: true });

    let filePath;
    let contentType;
    let fileName;

    switch (format.toLowerCase()) {
      case 'txt': {
        filePath = join(tempDir, `${Date.now()}.txt`);
        await fs.writeFile(filePath, transcription || '', 'utf-8');
        contentType = 'text/plain';
        fileName = `${title}.txt`;
        break;
      }

      case 'docx': {
        const doc = new Document({
          sections: [{
            properties: {},
            children: (transcription || '').split('\n').map((line) =>
              new Paragraph({ children: [new TextRun(line || ' ')] })
            )
          }]
        });
        filePath = join(tempDir, `${Date.now()}.docx`);
        const buffer = await Packer.toBuffer(doc);
        await fs.writeFile(filePath, buffer);
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        fileName = `${title}.docx`;
        break;
      }

      case 'pdf': {
        const pdfDoc = await PDFDocument.create();
        let page = pdfDoc.addPage([595, 842]);
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontSize = 12;
        const margin = 50;
        const maxWidth = page.getWidth() - 2 * margin;
        let y = page.getHeight() - margin;
        for (const line of (transcription || '').split('\n')) {
          if (y < margin + fontSize) {
            page = pdfDoc.addPage([595, 842]);
            y = page.getHeight() - margin;
          }
          page.drawText(line, {
            x: margin, y, size: fontSize, font, maxWidth, color: rgb(0, 0, 0)
          });
          y -= fontSize + 5;
        }
        const pdfBytes = await pdfDoc.save();
        filePath = join(tempDir, `${Date.now()}.pdf`);
        await fs.writeFile(filePath, pdfBytes);
        contentType = 'application/pdf';
        fileName = `${title}.pdf`;
        break;
      }

      case 'json': {
        const jsonData = {
          title,
          transcription,
          segments: segments || [],
          exportedAt: new Date().toISOString()
        };
        filePath = join(tempDir, `${Date.now()}.json`);
        await fs.writeFile(filePath, JSON.stringify(jsonData, null, 2), 'utf-8');
        contentType = 'application/json';
        fileName = `${title}.json`;
        break;
      }

      case 'srt': {
        const segs = (segments && segments.length > 0)
          ? segments
          : fakeSegmentFromText(transcription || '');
        filePath = join(tempDir, `${Date.now()}.srt`);
        await fs.writeFile(filePath, toSrt(segs), 'utf-8');
        contentType = 'application/x-subrip';
        fileName = `${title}.srt`;
        break;
      }

      case 'vtt': {
        const segs = (segments && segments.length > 0)
          ? segments
          : fakeSegmentFromText(transcription || '');
        filePath = join(tempDir, `${Date.now()}.vtt`);
        await fs.writeFile(filePath, toVtt(segs), 'utf-8');
        contentType = 'text/vtt';
        fileName = `${title}.vtt`;
        break;
      }

      default:
        return res.status(400).json({ error: `Unsupported format: ${format}` });
    }

    res.setHeader('Content-Type', contentType);
    res.download(filePath, fileName, (err) => {
      if (err) console.error('Download error:', err);
      setTimeout(() => fs.unlink(filePath).catch(() => {}), 5000);
    });
  } catch (error) {
    next(error);
  }
});

// Export helpers exposed for tests.
export const _internal = { toSrt, toVtt, formatTimestamp };

export default router;
