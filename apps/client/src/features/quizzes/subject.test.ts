import { describe, expect, it } from 'vitest';
import { matchSubject } from './subject';

describe('matchSubject', () => {
  it("uses the teacher's spelling when only the capitals differ", () => {
    expect(matchSubject(['Maths', 'Science'], ' maths ')).toBe('Maths');
  });

  it('keeps a subject that is not in the list as it is', () => {
    expect(matchSubject(['Maths'], 'History')).toBe('History');
  });

  it('keeps an empty choice empty', () => {
    expect(matchSubject(['Maths'], '')).toBe('');
  });
});
