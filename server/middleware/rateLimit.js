import rateLimit from 'express-rate-limit';

// Generic API limiter — 60 requests/minute per IP.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  // Audio playback issues many HTTP range requests while seeking/buffering;
  // counting each against the API budget would stall the player. Media streams
  // are cheap static reads, so exempt them.
  skip: (req) => req.method === 'GET' && /\/audio$/.test(req.path),
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
