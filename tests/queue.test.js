import { describe, it, expect } from 'vitest';
import { enqueue, getTask } from '../server/utils/queue.js';

function waitFor(predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('timeout'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe('queue', () => {
  it('runs a task and stores result', async () => {
    const id = enqueue(async () => 42, { label: 'demo' });
    await waitFor(() => getTask(id)?.status === 'succeeded');
    const t = getTask(id);
    expect(t.status).toBe('succeeded');
    expect(t.result).toBe(42);
  });

  it('captures errors', async () => {
    const id = enqueue(async () => { throw new Error('boom'); });
    await waitFor(() => getTask(id)?.status === 'failed');
    const t = getTask(id);
    expect(t.status).toBe('failed');
    expect(t.error).toBe('boom');
  });

  it('returns null for unknown task', () => {
    expect(getTask('nope')).toBeNull();
  });
});
