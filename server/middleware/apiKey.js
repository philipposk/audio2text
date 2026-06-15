// API key auth + per-key daily quota.
//
// Authentication:
//   Header: x-api-key: tr_xxx
//   Or:     Authorization: Bearer tr_xxx
//
// Modes:
//   - If env API_KEYS_REQUIRED=true, requests without a valid key are rejected.
//   - Otherwise auth is optional; quota tracking only applies when a key is
//     supplied. A privileged admin key can be set via ADMIN_API_KEY for the
//     /api/keys management routes.
//
// Quota:
//   - Each key has a `dailyMinutes` budget (free=30 by default).
//   - On heavy endpoints we record audio seconds used; once seconds exceed
//     dailyMinutes*60, subsequent calls return 429.

import { findApiKey, getUsageToday, recordUsage } from '../db/index.js';
import { safeEqual } from '../utils/safeCompare.js';

function extractKey(req) {
  const headerKey = req.header('x-api-key');
  if (headerKey) return headerKey.trim();
  const auth = req.header('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

export async function attachApiKey(req, res, next) {
  try {
    const required = String(process.env.API_KEYS_REQUIRED || 'false') === 'true';
    const raw = extractKey(req);

    // Admin shortcut: ADMIN_API_KEY bypasses lookup and quotas entirely.
    if (raw && process.env.ADMIN_API_KEY && safeEqual(raw, process.env.ADMIN_API_KEY)) {
      req.apiKey = { key: raw, label: 'admin', plan: 'admin', dailyMinutes: Infinity, admin: true };
      return next();
    }

    if (!raw) {
      if (required) return res.status(401).json({ error: 'API key required (set x-api-key header).' });
      return next();
    }
    const record = await findApiKey(raw);
    if (!record) {
      if (required) return res.status(401).json({ error: 'Invalid API key' });
      return next(); // unknown key but auth not required → proceed anonymously
    }
    req.apiKey = record;
    next();
  } catch (e) { next(e); }
}

export async function enforceQuota(req, res, next) {
  try {
    if (!req.apiKey) return next(); // anonymous mode allowed (when API_KEYS_REQUIRED=false)
    if (req.apiKey.admin) return next();
    const usage = await getUsageToday(req.apiKey.key);
    const limitSec = (req.apiKey.dailyMinutes || 30) * 60;
    if (usage.seconds >= limitSec) {
      return res.status(429).json({
        error: 'Daily quota exceeded',
        usedSeconds: usage.seconds,
        limitSeconds: limitSec
      });
    }
    req.usageToday = usage;
    next();
  } catch (e) { next(e); }
}

/**
 * Helper for route handlers to log audio seconds after a job completes.
 */
export async function chargeUsage(req, seconds, endpoint) {
  if (!req.apiKey || req.apiKey.admin) return;
  await recordUsage({ key: req.apiKey.key, seconds: Math.max(0, Math.round(seconds || 0)), endpoint });
}

export function requireAdmin(req, res, next) {
  if (!req.apiKey || !req.apiKey.admin) {
    return res.status(403).json({ error: 'Admin API key required (set ADMIN_API_KEY).' });
  }
  next();
}
