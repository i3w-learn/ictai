import { describe, expect, it } from 'vitest';
import { cardStudent } from './audit-words';

describe('cardStudent', () => {
  it('gives the student of a published, frozen or taken-back report card', () => {
    for (const action of ['report_card.published', 'report_card.frozen', 'report_card.draft']) {
      expect(cardStudent({ action, detail: { student: 'Asha Patil', term: 'Term 1' } })).toBe('Asha Patil');
    }
  });

  it('gives nothing when the line kept no name', () => {
    expect(cardStudent({ action: 'report_card.frozen', detail: null })).toBeNull();
    expect(cardStudent({ action: 'report_card.frozen', detail: { term: 'Term 1' } })).toBeNull();
    expect(cardStudent({ action: 'report_card.frozen', detail: { student: '  ' } })).toBeNull();
  });

  it('gives nothing for other lines, even with a student in the detail', () => {
    expect(cardStudent({ action: 'report_cards.make', detail: { student: 'Asha Patil' } })).toBeNull();
    expect(cardStudent({ action: 'signin', detail: null })).toBeNull();
  });
});
