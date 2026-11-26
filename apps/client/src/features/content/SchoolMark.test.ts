import { describe, expect, it } from 'vitest';
import { SPOTS, spotAt } from './SchoolMark';

describe('where the school name sits over a video', () => {
  it('goes round the places in turn and starts again', () => {
    expect(SPOTS.map((_, i) => spotAt(i))).toEqual([...SPOTS]);
    expect(spotAt(SPOTS.length)).toBe(SPOTS[0]);
    expect(spotAt(SPOTS.length * 3 + 2)).toBe(SPOTS[2]);
  });

  it('never sits in the middle or on the bottom edge, where the lesson and its writing are', () => {
    for (const spot of SPOTS) {
      expect(spot).toMatch(/\b(left|right)-4\b/);
      expect(spot).not.toMatch(/bottom-\d+$|bottom-\d+ /);
    }
  });
});
