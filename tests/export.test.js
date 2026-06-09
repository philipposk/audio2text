import { describe, it, expect } from 'vitest';
import { _internal } from '../server/routes/export.js';

const { toSrt, toVtt, formatTimestamp } = _internal;

describe('formatTimestamp', () => {
  it('formats whole seconds', () => {
    expect(formatTimestamp(0)).toBe('00:00:00,000');
    expect(formatTimestamp(61.5)).toBe('00:01:01,500');
    expect(formatTimestamp(3661.123)).toBe('01:01:01,123');
  });
  it('uses dot separator for VTT', () => {
    expect(formatTimestamp(1.25, '.')).toBe('00:00:01.250');
  });
  it('clamps negatives', () => {
    expect(formatTimestamp(-5)).toBe('00:00:00,000');
  });
});

describe('toSrt', () => {
  it('emits numbered cues with comma timestamps', () => {
    const segs = [
      { start: 0, end: 2, text: 'hi' },
      { start: 2, end: 4, text: 'there' }
    ];
    const out = toSrt(segs);
    expect(out).toContain('1\n00:00:00,000 --> 00:00:02,000\nhi');
    expect(out).toContain('2\n00:00:02,000 --> 00:00:04,000\nthere');
  });

  it('prefers translatedText when present', () => {
    const out = toSrt([{ start: 0, end: 1, text: 'hi', translatedText: 'γεια' }]);
    expect(out).toContain('γεια');
    expect(out).not.toContain('\nhi');
  });
});

describe('toVtt', () => {
  it('starts with WEBVTT header and dot timestamps', () => {
    const out = toVtt([{ start: 0, end: 1.5, text: 'hi' }]);
    expect(out.startsWith('WEBVTT\n')).toBe(true);
    expect(out).toContain('00:00:00.000 --> 00:00:01.500');
  });
});
