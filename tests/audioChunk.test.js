import { describe, it, expect } from 'vitest';
import { mergeTranscriptions } from '../server/utils/audioChunk.js';

describe('mergeTranscriptions', () => {
  it('offsets segments + words by chunk start, concatenates text', () => {
    const merged = mergeTranscriptions([
      {
        result: {
          text: 'hello there',
          segments: [{ start: 0, end: 1, text: 'hello' }, { start: 1, end: 2, text: 'there' }],
          words: [{ start: 0, end: 0.5, word: 'hello' }],
          duration: 2,
          language: 'en'
        },
        startSec: 0
      },
      {
        result: {
          text: 'general kenobi',
          segments: [{ start: 0, end: 2, text: 'general kenobi' }],
          words: [{ start: 0, end: 0.5, word: 'general' }],
          duration: 3,
          language: 'en'
        },
        startSec: 1500
      }
    ]);

    expect(merged.text).toBe('hello there general kenobi');
    expect(merged.language).toBe('en');
    expect(merged.duration).toBe(1503);
    expect(merged.segments).toHaveLength(3);
    expect(merged.segments[2].start).toBe(1500);
    expect(merged.segments[2].end).toBe(1502);
    expect(merged.words[1].start).toBe(1500);
  });

  it('handles empty inputs gracefully', () => {
    const merged = mergeTranscriptions([]);
    expect(merged.text).toBe('');
    expect(merged.segments).toEqual([]);
    expect(merged.words).toEqual([]);
  });
});
