// Central error handler — keeps responses consistent and avoids leaking stack traces.
export function notFound(req, res, next) {
  res.status(404).json({ error: 'Not found', path: req.path });
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  if (status >= 500) {
    console.error('[errorHandler]', err);
  }
  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && err.stack ? { stack: err.stack } : {})
  });
}
