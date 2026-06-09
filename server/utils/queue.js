// Tiny in-process job queue. Suitable for single-instance deployments; swap
// for BullMQ/Redis when going multi-instance.
//
// State machine: pending -> running -> succeeded|failed
// Tasks are arbitrary async functions; the queue stores their result or error
// and optionally POSTs to a callback URL on completion.

import { EventEmitter } from 'events';

const tasks = new Map();
const emitter = new EventEmitter();
let workers = 0;
const MAX_WORKERS = parseInt(process.env.QUEUE_WORKERS || '2', 10);

function id() {
  return 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function postCallback(url, payload) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000)
    });
  } catch (e) {
    console.error('[queue] callback failed', url, e.message);
  }
}

async function runOne() {
  const next = [...tasks.values()].find((t) => t.status === 'pending');
  if (!next) return;
  if (workers >= MAX_WORKERS) return;
  workers++;
  next.status = 'running';
  next.startedAt = new Date().toISOString();
  emitter.emit('update', next);
  try {
    const result = await next.fn();
    next.status = 'succeeded';
    next.result = result;
  } catch (err) {
    next.status = 'failed';
    next.error = err.message || String(err);
  } finally {
    next.finishedAt = new Date().toISOString();
    workers--;
    emitter.emit('update', next);
    if (next.callbackUrl) {
      postCallback(next.callbackUrl, {
        id: next.id,
        status: next.status,
        result: next.result,
        error: next.error
      });
    }
    setImmediate(runOne);
  }
}

export function enqueue(fn, { callbackUrl, label } = {}) {
  const taskId = id();
  tasks.set(taskId, {
    id: taskId,
    status: 'pending',
    label: label || null,
    callbackUrl: callbackUrl || null,
    createdAt: new Date().toISOString(),
    fn
  });
  // Drop stale entries (older than 1h) to bound memory.
  const cutoff = Date.now() - 3600_000;
  for (const [k, v] of tasks) {
    if (v.status !== 'pending' && v.status !== 'running' && new Date(v.finishedAt || v.createdAt).getTime() < cutoff) {
      tasks.delete(k);
    }
  }
  setImmediate(runOne);
  return taskId;
}

function publicView(task) {
  // Strip the function reference before serializing to API consumers.
  const { fn: _fn, ...rest } = task;
  return rest;
}

export function getTask(taskId) {
  const t = tasks.get(taskId);
  return t ? publicView(t) : null;
}

export function listTasks() {
  return [...tasks.values()].map(publicView);
}

export { emitter as queueEvents };
