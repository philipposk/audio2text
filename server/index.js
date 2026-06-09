import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import expressWs from 'express-ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import transcriptionRoutes from './routes/transcription.js';
import chatRoutes from './routes/chat.js';
import exportRoutes from './routes/export.js';
import messagingRoutes from './routes/messaging.js';
import translateRoutes from './routes/translate.js';
import ingestRoutes from './routes/ingest.js';
import jobRoutes from './routes/jobs.js';
import summaryRoutes from './routes/summary.js';
import diarizeRoutes from './routes/diarize.js';
import detectRoutes from './routes/detect.js';
import batchRoutes from './routes/batch.js';
import burnRoutes from './routes/burn.js';
import asyncRoutes from './routes/async.js';
import keyRoutes from './routes/keys.js';
import glossaryRoutes from './routes/glossary.js';
import { registerLiveWs } from './routes/live.js';

import { apiLimiter, heavyLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { attachApiKey, enforceQuota } from './middleware/apiKey.js';
import { requestLogger } from './utils/logger.js';
import { openApiSpec } from './openapi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

/**
 * Build the Express app. Exported so tests can mount it without binding a port.
 */
export function createApp({ withWebsocket = process.env.NODE_ENV !== 'test' } = {}) {
  const app = express();
  if (withWebsocket) {
    expressWs(app);
  }

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use('/uploads', express.static(join(__dirname, '../uploads')));

  // Structured request logging (silent under tests).
  app.use(requestLogger);

  // API key attachment runs for every /api request so downstream routes can
  // see req.apiKey when present. Quota enforcement is applied on heavy paths.
  app.use('/api', attachApiKey);

  // Global API limiter (skip when running under vitest to keep tests deterministic).
  if (process.env.NODE_ENV !== 'test') {
    app.use('/api', apiLimiter);
    app.use('/api/transcribe', heavyLimiter, enforceQuota);
    app.use('/api/translate', heavyLimiter);
    app.use('/api/ingest', heavyLimiter, enforceQuota);
    app.use('/api/tasks', heavyLimiter, enforceQuota);
    app.use('/api/burn', heavyLimiter, enforceQuota);
    app.use('/api/diarize', heavyLimiter, enforceQuota);
  }

  app.use('/api/transcribe/batch', batchRoutes);
  app.use('/api/transcribe', transcriptionRoutes);
  app.use('/api/translate', translateRoutes);
  app.use('/api/ingest', ingestRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api/messaging', messagingRoutes);
  app.use('/api/jobs', jobRoutes);
  app.use('/api/summary', summaryRoutes);
  app.use('/api/diarize', diarizeRoutes);
  app.use('/api/detect-language', detectRoutes);
  app.use('/api/burn', burnRoutes);
  app.use('/api/tasks', asyncRoutes);
  app.use('/api/keys', keyRoutes);
  app.use('/api/glossaries', glossaryRoutes);

  app.get('/api/openapi.json', (req, res) => res.json(openApiSpec));

  if (withWebsocket) {
    registerLiveWs(app);
  }

  app.get('/api/health', async (req, res) => {
    const { listJobs } = await import('./db/index.js');
    const { listTasks } = await import('./utils/queue.js');
    let dbOk = true;
    let jobCount = 0;
    try {
      const { total } = await listJobs({ limit: 1 });
      jobCount = total;
    } catch {
      dbOk = false;
    }
    const tasks = listTasks();
    res.json({
      status: dbOk ? 'ok' : 'degraded',
      service: 'Translator',
      version: '2.1.0',
      uptimeSec: Math.round(process.uptime()),
      providers: {
        openai: !!process.env.OPENAI_API_KEY,
        groq: !!process.env.GROQ_API_KEY,
        replicate: !!process.env.REPLICATE_API_TOKEN,
        telegram: !!process.env.TELEGRAM_BOT_TOKEN,
        whatsapp: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
        messenger: !!process.env.MESSENGER_PAGE_TOKEN
      },
      db: { ok: dbOk, jobCount },
      queue: {
        pending: tasks.filter((t) => t.status === 'pending').length,
        running: tasks.filter((t) => t.status === 'running').length,
        finished: tasks.filter((t) => t.status === 'succeeded' || t.status === 'failed').length
      }
    });
  });

  app.get('/api/metrics', async (req, res) => {
    const { listJobs } = await import('./db/index.js');
    const { listTasks } = await import('./utils/queue.js');
    const { jobs, total } = await listJobs({ limit: 200 });
    const byType = {};
    const byLanguage = {};
    let totalDuration = 0;
    for (const j of jobs) {
      byType[j.type] = (byType[j.type] || 0) + 1;
      if (j.language) byLanguage[j.language] = (byLanguage[j.language] || 0) + 1;
      totalDuration += j.duration || 0;
    }
    const memory = process.memoryUsage();
    res.json({
      jobs: { total, recentByType: byType, recentByLanguage: byLanguage, recentTotalDurationSec: Math.round(totalDuration) },
      queue: { taskCount: listTasks().length },
      memory: { rssMb: Math.round(memory.rss / 1024 / 1024), heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024) },
      uptimeSec: Math.round(process.uptime())
    });
  });

  // SPA in production.
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(join(__dirname, '../dist')));
    app.get('*', (req, res) => {
      res.sendFile(join(__dirname, '../dist/index.html'));
    });
  }

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}

// Only listen when run directly (skip during tests).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const PORT = process.env.PORT || 3000;
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`🚀 Translator server running on port ${PORT}`);
    console.log(`📝 API: http://localhost:${PORT}/api`);
  });
}

export default createApp;
