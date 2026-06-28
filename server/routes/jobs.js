// History + bulk-translation endpoints for transcription/translation jobs.
import express from 'express';
import { randomBytes } from 'crypto';
import { listJobs, getJob, deleteJob, createJob, updateJob, getGlossary } from '../db/index.js';
import { chatComplete } from '../utils/ai.js';
import { streamAudio, audioFilePath, removeAudio } from '../utils/audioStore.js';

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

async function translateBatch(items, sourceLang, targetLang, glossary) {
  const numbered = items.map((s, i) => `${i + 1}. ${s}`).join('\n');
  // Inject glossary term mappings so technical terms/names translate consistently.
  const glossaryLines = glossary && Object.keys(glossary).length
    ? '\nUse this glossary for these terms (source = exact target):\n' +
      Object.entries(glossary).map(([k, v]) => `  ${k} = ${v}`).join('\n')
    : '';
  const systemPrompt = `You translate subtitle segments from ${sourceLang || 'auto-detected source'} into ${targetLang}.
Return STRICT JSON: {"translations": ["...", "..."]} with exactly ${items.length} entries, preserving order.
No markdown, no commentary.${glossaryLines}`;
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
 * GET /api/jobs/:id/audio
 * Streams the stored source audio (range-enabled for seeking). 404 if the job
 * has no persisted audio (e.g. URL/live jobs, or running on Vercel).
 */
router.get('/:id/audio', async (req, res, next) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const file = job.meta?.audioFile;
    if (!file) return res.status(404).json({ error: 'No audio stored for this job' });
    return streamAudio(req, res, audioFilePath(file), job.meta?.audioMime);
  } catch (e) { next(e); }
});

/**
 * PATCH /api/jobs/:id/segments
 * Body: { segments: [{start,end,text,speaker?}, ...] }
 * Replaces the job's segments (used for inline transcript editing) and keeps the
 * flat `text` in sync so exports/summaries reflect the edits.
 */
router.patch('/:id/segments', async (req, res, next) => {
  try {
    const { segments } = req.body || {};
    if (!Array.isArray(segments)) {
      return res.status(400).json({ error: 'segments must be an array' });
    }
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const clean = segments.map(s => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || ''),
      ...(s.speaker ? { speaker: String(s.speaker) } : {}),
    }));
    const text = clean.map(s => s.text).join(' ').trim();
    const updated = await updateJob(req.params.id, { segments: clean, text });
    res.json({ success: true, job: updated });
  } catch (e) { next(e); }
});

/**
 * POST /api/jobs/:id/translate
 * Body: { targetLang, sourceLang? }
 * Translates each segment, persists a new job linked to the original.
 */
router.post('/:id/translate', async (req, res, next) => {
  try {
    const { targetLang, sourceLang, glossaryId } = req.body || {};
    if (!targetLang) return res.status(400).json({ error: 'targetLang required' });

    const source = await getJob(req.params.id);
    if (!source) return res.status(404).json({ error: 'Job not found' });
    if (!source.segments || source.segments.length === 0) {
      return res.status(400).json({ error: 'Source job has no segments to translate' });
    }

    // Optional glossary for consistent terminology across the translation.
    let glossary = null;
    if (glossaryId) {
      const g = await getGlossary(glossaryId);
      if (g) glossary = g.entries || null;
    }

    const batches = batchSegments(source.segments);
    const translatedTexts = [];
    for (const batch of batches) {
      const items = batch.map((s) => s.text || '');
      const out = await translateBatch(items, sourceLang || source.language, targetLang, glossary);
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
        targetLang,
        glossaryId: glossaryId || null
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

/**
 * POST /api/jobs/:id/share  → create (or return existing) public share token.
 * DELETE same path          → revoke sharing.
 * The token is read at the public, unauthenticated GET /api/share/:token route.
 */
router.post('/:id/share', async (req, res, next) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const shareToken = job.meta?.shareToken || randomBytes(12).toString('base64url');
    if (!job.meta?.shareToken) {
      await updateJob(job.id, { meta: { ...(job.meta || {}), shareToken } });
    }
    res.json({ success: true, shareToken, path: `/s/${shareToken}` });
  } catch (e) { next(e); }
});

router.delete('/:id/share', async (req, res, next) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const meta = { ...(job.meta || {}) };
    delete meta.shareToken;
    await updateJob(job.id, { meta });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const job = await getJob(req.params.id);
    const ok = await deleteJob(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Job not found' });
    // Remove the stored audio too so deleting a job reclaims its disk space.
    if (job?.meta?.audioFile) await removeAudio(job.meta.audioFile);
    res.json({ success: true });
  } catch (e) { next(e); }
});

export default router;
