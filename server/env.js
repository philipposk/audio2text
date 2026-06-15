// Load environment variables BEFORE any other local module is imported.
// Import this first in entry points (server/index.js, api/index.js) so every
// module that reads process.env at import time sees the values from .env.
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });
