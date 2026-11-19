import { describe, expect, it } from 'vitest';
import { turnPage } from './show-pages';

describe('turnPage', () => {
  it('goes on and back one page', () => {
    expect(turnPage(3, 1, 120)).toBe(4);
    expect(turnPage(3, -1, 120)).toBe(2);
  });
  it('stays inside the book', () => {
    expect(turnPage(1, -1, 120)).toBe(1);
    expect(turnPage(120, 1, 120)).toBe(120);
  });
  it('does not go on while the number of pages is not known', () => {
    expect(turnPage(1, 1, null)).toBe(1);
    expect(turnPage(2, -1, null)).toBe(1);
  });
});
