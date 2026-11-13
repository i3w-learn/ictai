import { describe, expect, it } from 'vitest';
import { prefsAttrs } from './prefs';
import { plusMinutes } from './SettingsPanel';

describe('student screen settings', () => {
  it('marks nothing for the plain look, or when nobody is signed in', () => {
    expect(prefsAttrs(null)).toEqual({ text: null, contrast: null, font: null });
    expect(prefsAttrs({ textSize: 'normal', highContrast: false, easyFont: false })).toEqual({ text: null, contrast: null, font: null });
  });

  it('marks each choice the student made', () => {
    expect(prefsAttrs({ textSize: 'xlarge', highContrast: true, easyFont: true })).toEqual({ text: 'xlarge', contrast: 'high', font: 'easy' });
    expect(prefsAttrs({ textSize: 'large', highContrast: false, easyFont: false })).toEqual({ text: 'large', contrast: null, font: null });
  });
});


describe('period times', () => {
  it('adds minutes on the clock and stops at the end of the day', () => {
    expect(plusMinutes('09:00', 40)).toBe('09:40');
    expect(plusMinutes('09:40', 40)).toBe('10:20');
    expect(plusMinutes('23:50', 40)).toBe('23:59');
  });
});
