// Writable directories. On serverless (Vercel) the deployment filesystem is
// read-only except for /tmp, so all uploads/temp/data must live under /tmp there.
// Self-hosted, they live under the project root as before.
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const base = process.env.VERCEL ? '/tmp' : root;

export const UPLOADS_DIR = join(base, 'uploads');
export const TEMP_DIR = join(base, 'temp');
export const DATA_DIR = join(base, 'data');
export const AUDIO_DIR = join(base, 'uploads', 'audio');
export const LIVE_DIR = join(base, 'uploads', 'live');

// Eagerly create them so multer string destinations (which don't auto-mkdir)
// and direct writers never hit ENOENT. Best-effort; ignore if already present.
for (const dir of [UPLOADS_DIR, TEMP_DIR, AUDIO_DIR]) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
}
