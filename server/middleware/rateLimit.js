import rateLimit from 'express-rate-limit';

// Generic API limiter — 60 requests/minute per IP.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' }
});

// Tighter limiter for expensive endpoints (transcription, translation, ingest).
export const heavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded for heavy endpoint. Try again in a minute.' }
});
