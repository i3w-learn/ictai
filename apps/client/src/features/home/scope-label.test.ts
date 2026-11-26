import { describe, expect, it } from 'vitest';
import { translate, type T } from '../../i18n/i18n';
import { scopeLabel } from './scope-label';

const name = (id: string) => ({ a: '7', b: '8' })[id as 'a' | 'b'] ?? '?';
const t: T = (text, vars) => translate('en', text, vars);

describe('scopeLabel', () => {
  it('names the classes and subjects', () => {
    expect(scopeLabel({ classIds: ['a', 'b'], subjects: ['Maths', 'Hindi'] }, name, t)).toBe('Classes 7, 8 · Maths, Hindi');
    expect(scopeLabel({ classIds: ['a'], subjects: ['Maths'] }, name, t)).toBe('Class 7 · Maths');
  });

  // Each half stands on its own: "nothing set" on one side must not hide what is set on the other.
  it('says so when either half is open', () => {
    expect(scopeLabel({ classIds: [], subjects: ['Maths'] }, name, t)).toBe('All classes · Maths');
    expect(scopeLabel({ classIds: ['a'], subjects: [] }, name, t)).toBe('Class 7 · All subjects');
    expect(scopeLabel({ classIds: [], subjects: [] }, name, t)).toBe('All classes and subjects');
  });
});
