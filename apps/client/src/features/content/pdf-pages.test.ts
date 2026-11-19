import { describe, expect, it } from 'vitest';
import { fitInside, totalOf } from './pdf-pages';

describe('PDF reader sums', () => {
  it('fits a tall page into a wide box by its height, and a wide page into a tall box by its width', () => {
    expect(fitInside(1000, 500, 0.75)).toEqual({ width: 375, height: 500 });
    expect(fitInside(400, 1000, 2)).toEqual({ width: 400, height: 200 });
    expect(fitInside(800, 600, 4 / 3)).toEqual({ width: 800, height: 600 });
  });

  it('draws nothing in a box with no room, or for a page with no shape', () => {
    expect(fitInside(0, 500, 1)).toBeNull();
    expect(fitInside(500, 500, 0)).toBeNull();
    expect(fitInside(500, 500, Number.NaN)).toBeNull();
  });

  it('reads the whole size from the answer to a part request', () => {
    expect(totalOf('bytes 0-262143/9000000')).toBe(9_000_000);
    expect(totalOf('bytes 0-9/*')).toBeNull();
    expect(totalOf('')).toBeNull();
    expect(totalOf(null)).toBeNull();
  });
});
