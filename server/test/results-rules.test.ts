import { describe, expect, it } from 'vitest';
import { averageOf, bandOf, gradeOf, percentOf } from '../src/modules/results/rules.js';

describe('result rules', () => {
  it('percent is whole and never above 100', () => {
    expect(percentOf(3, 4)).toBe(75);
    expect(percentOf(5, 4)).toBe(100);
    expect(percentOf(0, 0)).toBe(0);
  });

  it('bands students like v2', () => {
    expect(bandOf(60)).toBe('great');
    expect(bandOf(59)).toBe('growing');
    expect(bandOf(30)).toBe('growing');
    expect(bandOf(29)).toBe('needs');
    expect(bandOf(null)).toBe('none');
  });

  it('grades', () => expect([90, 80, 70, 60, 50, 49].map(gradeOf)).toEqual(['A+', 'A', 'B', 'C', 'D', 'E']));

  it('average is null with no attempts', () => {
    expect(averageOf([])).toBeNull();
    expect(averageOf([50, 75])).toBe(63);
  });
});
