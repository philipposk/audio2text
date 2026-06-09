// API-key management. Gated by ADMIN_API_KEY (no anon access ever).
import express from 'express';
import { createApiKey, listApiKeys, revokeApiKey, getUsageToday } from '../db/index.js';
import { requireAdmin } from '../middleware/apiKey.js';

const router = express.Router();

router.use(requireAdmin);

router.post('/', async (req, res, next) => {
  try {
    const { label, plan, dailyMinutes } = req.body || {};
    const rec = await createApiKey({ label, plan, dailyMinutes });
    res.json({ success: true, apiKey: rec });
  } catch (e) { next(e); }
});

router.get('/', async (req, res, next) => {
  try {
    const keys = await listApiKeys();
    res.json({ keys });
  } catch (e) { next(e); }
});

router.delete('/:key', async (req, res, next) => {
  try {
    const ok = await revokeApiKey(req.params.key);
    if (!ok) return res.status(404).json({ error: 'Key not found' });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.get('/:key/usage', async (req, res, next) => {
  try {
    const usage = await getUsageToday(req.params.key);
    res.json({ usage });
  } catch (e) { next(e); }
});

export default router;
