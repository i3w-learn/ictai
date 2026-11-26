import { describe, expect, it } from 'vitest';
import { translate, type T } from '../../i18n/i18n';
import { endOfDay, whoFor } from './notices';

const t: T = (s, v) => translate('en', s, v);

describe('notices', () => {
  it('says who a notice is for', () => {
    expect(whoFor({ className: null, sectionName: null }, t)).toBe('Whole school');
    expect(whoFor({ className: '7', sectionName: null }, t)).toBe('Class 7');
    expect(whoFor({ className: '7', sectionName: 'A' }, t)).toBe('Class 7 A');
  });

  it('keeps a notice up through the whole of its last day', () => {
    const end = new Date(endOfDay('2026-11-14'));
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMinutes()]).toEqual([2026, 10, 14, 23, 59]);
    expect(endOfDay('2026-11-14')).toBeLessThan(new Date(2026, 10, 15).getTime());
  });
});
