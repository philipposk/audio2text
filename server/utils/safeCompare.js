// Constant-time string comparison for secrets (API keys, webhook tokens).
//
// A plain `a === b` short-circuits on the first differing byte, leaking timing
// that can be used to recover a secret byte-by-byte over many requests. We hash
// both sides to a fixed 32-byte digest first (so unequal lengths don't throw and
// don't leak length), then compare with crypto.timingSafeEqual.

import { createHash, timingSafeEqual } from 'crypto';

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
