import { describe, expect, it } from 'vitest';
import { streams } from './useFileUrl';

describe('which files are streamed', () => {
  it('streams pictures, videos and sound, and a PDF only when the app draws its pages', () => {
    expect(['image', 'video', 'audio'].every((k) => streams(k as 'image'))).toBe(true);
    expect(streams('pdf')).toBe(false);
    expect(streams('pdf', true)).toBe(true);
    expect(streams('link', true)).toBe(false);
  });
});
