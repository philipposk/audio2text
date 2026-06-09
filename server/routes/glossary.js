// CRUD for translation glossaries — name/value maps the LLM is instructed to
// preserve verbatim during translation. Reference one in /api/translate via
// { glossaryId } (server merges its entries into the prompt).

import express from 'express';
import {
  createGlossary, listGlossaries, getGlossary, updateGlossary, deleteGlossary
} from '../db/index.js';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { name, sourceLang, targetLang, entries } = req.body || {};
    if (entries && typeof entries !== 'object') {
      return res.status(400).json({ error: '"entries" must be an object of {source: target} strings' });
    }
    const rec = await createGlossary({ name, sourceLang, targetLang, entries });
    res.json({ success: true, glossary: rec });
  } catch (e) { next(e); }
});

router.get('/', async (req, res, next) => {
  try {
    const glossaries = await listGlossaries();
    res.json({ glossaries });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const g = await getGlossary(req.params.id);
    if (!g) return res.status(404).json({ error: 'Glossary not found' });
    res.json({ glossary: g });
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const g = await updateGlossary(req.params.id, req.body || {});
    if (!g) return res.status(404).json({ error: 'Glossary not found' });
    res.json({ success: true, glossary: g });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const ok = await deleteGlossary(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Glossary not found' });
    res.json({ success: true });
  } catch (e) { next(e); }
});

export default router;
