// Single shared pino logger. Pretty in dev, JSON in prod/test.
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.body.OPENAI_API_KEY',
      'req.body.GROQ_API_KEY',
      'req.body.REPLICATE_API_TOKEN',
      '*.token',
      '*.password'
    ],
    censor: '[REDACTED]'
  },
  ...(isDev ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } } } : {})
});

/**
 * Lightweight request logger middleware.
 */
export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    logger.info({
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms,
      apiKey: req.apiKey?.key ? req.apiKey.key.slice(0, 8) + '…' : null
    }, 'http');
  });
  next();
}
