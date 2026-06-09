// History + bulk-translation endpoints for transcription/translation jobs.
import express from 'express';
import { listJobs, getJob, deleteJob, createJob, updateJob } from '../db/index.js';
import { chatComplete } from '../utils/ai.js';

const router = express.Router();

// Chunk segment array into LLM-safe batches (cap ~80 segs / ~6k chars per call).
function batchSegments(segments, maxItems = 80, maxChars = 6000) {
  const batches = [];
  let cur = [];
  let curChars = 0;
  for (const seg of segments) {
    const segChars = (seg.text || '').length + 4;
    if (cur.length >= maxItems || curChars + segChars > maxChars) {
      if (cur.length) batches.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(seg);
    curChars += segChars;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

async function translateBatch(items, sourceLang, targetLang) {
  const numbered = items.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const systemPrompt = `You translate subtitle segments from ${sourceLang || 'auto-detected source'} into ${targetLang}.
Return STRICT JSON: {"translations": ["...", "..."]} with exactly ${items.length} entries, preserving order.
No markdown, no commentary.`;
  const { text } = await chatComplete({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: numbered }
    ],
    temperature: 0.2,
    maxTokens: 4000
  });
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim());
  } catch {
    throw Object.assign(new Error('LLM returned non-JSON batch'), { status: 502 });
  }
  if (!parsed.translations || parsed.translations.length !== items.length) {
    throw Object.assign(new Error('Batch length mismatch'), { status: 502 });
  }
  return parsed.translations;
}

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const { q, language, task, type } = req.query;
    const { jobs, total } = await listJobs({ limit, offset, q, language, task, type });
    res.json({ jobs, total, limit, offset });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
  } catch (e) { next(e); }
});

/**
 * POST /api/jobs/:id/translate
 * Body: { targetLang, sourceLang? }
 * Translates each segment, persists a new job linked to the original.
 */
router.post('/:id/translate', async (req, res, next) => {
  try {
    const { targetLang, sourceLang } = req.body || {};
    if (!targetLang) return res.status(400).json({ error: 'targetLang required' });

    const source = await getJob(req.params.id);
    if (!source) return res.status(404).json({ error: 'Job not found' });
    if (!source.segments || source.segments.length === 0) {
      return res.status(400).json({ error: 'Source job has no segments to translate' });
    }

    const batches = batchSegments(source.segments);
    const translatedTexts = [];
    for (const batch of batches) {
      const items = batch.map((s) => s.text || '');
      const out = await translateBatch(items, sourceLang || source.language, targetLang);
      translatedTexts.push(...out);
    }

    const translatedSegments = source.segments.map((seg, i) => ({
      ...seg,
      originalText: seg.text,
      text: translatedTexts[i] || seg.text
    }));

    const fullText = translatedSegments.map((s) => s.text).join(' ').trim();

    const newJob = await createJob({
      type: 'translation',
      sourceName: source.sourceName ? `${source.sourceName} [${targetLang}]` : `Translation [${targetLang}]`,
      language: targetLang,
      task: 'translate',
      method: 'llm',
      duration: source.duration,
      text: fullText,
      segments: translatedSegments,
      meta: {
        sourceJobId: source.id,
        sourceLang: sourceLang || source.language || null,
        targetLang
      }
    });

    res.json({
      success: true,
      jobId: newJob.id,
      sourceJobId: source.id,
      segmentCount: translatedSegments.length,
      targetLang
    });
  } catch (e) { next(e); }
});

/**
 * PATCH /api/jobs/:id/speakers
 * Body: { renames: { "SPEAKER_00": "Alice", ... }, merge?: [["SPEAKER_01","SPEAKER_02"]] }
 * Rewrites speaker labels across all segments and updates derived `text`.
 */
router.patch('/:id/speakers', async (req, res, next) => {
  try {
    const { renames = {}, merge = [] } = req.body || {};
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!Array.isArray(job.segments) || job.segments.length === 0) {
      return res.status(400).json({ error: 'Job has no segments' });
    }

    // Build merged-label map: every member of a merge group maps to the first label.
    const mergeMap = {};
    for (const group of merge) {
      if (!Array.isArray(group) || group.length === 0) continue;
      const target = group[0];
      for (const member of group) mergeMap[member] = target;
    }

    const newSegments = job.segments.map((s) => {
      let label = s.speaker || null;
      if (label && mergeMap[label]) label = mergeMap[label];
      if (label && renames[label]) label = renames[label];
      return { ...s, speaker: label };
    });

    const newText = newSegments
      .map((s) => (s.speaker ? `[${s.speaker}] ${s.text}` : s.text))
      .join('\n');

    const speakers = Array.from(new Set(newSegments.map((s) => s.speaker).filter(Boolean)));
    const updated = await updateJob(job.id, {
      segments: newSegments,
      text: newText,
      meta: { ...(job.meta || {}), speakers }
    });

    res.json({ success: true, job: { id: updated.id, speakers, segmentCount: newSegments.length } });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const ok = await deleteJob(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Job not found' });
    res.json({ success: true });
  } catch (e) { next(e); }
});

export default router;
