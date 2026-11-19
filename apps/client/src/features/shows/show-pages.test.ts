import { describe, expect, it } from 'vitest';
import { InkEvent, Show } from '@ict/contracts';
import { pageWords, startingPlace, turnPage } from './show-pages';

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

describe('startingPlace', () => {
  it('keeps the page of a book the teacher is reading', () => {
    expect(startingPlace('pdf', { page: 7, pages: 120 })).toEqual({ page: 7, pages: 120 });
    expect(startingPlace('video', { page: 1 })).toEqual({ page: 1 });
  });
  it('starts a whiteboard blank at page 1 of 1, however many pages it had', () => {
    expect(startingPlace('whiteboard', { page: 3, pages: 4 })).toEqual({ page: 1, pages: 1 });
  });
});

describe('pageWords', () => {
  it('says the page and how many there are', () => {
    expect(pageWords(3, 120)).toBe('Page 3 of 120');
  });
  it('says only the page while the count is not known', () => {
    expect(pageWords(3, null)).toBe('Page 3');
  });
});

// A school may update the Server PC after the student PCs. An older server knows only videos and
// says nothing about kinds or pages; this screen must still read what it says.
describe('a show from an older server', () => {
  it('is a video on page 1 with no pages', () => {
    const old = { id: 's1', classId: 'c1', className: '7A', item: null, byName: 'Ravi K', playing: false, position: 0, rate: 1, at: 0, now: 0 };
    expect(Show.parse(old)).toMatchObject({ kind: 'video', page: 1, pages: null });
  });
  it('wipes page 1 when it wipes the writing', () => {
    expect(InkEvent.parse({ kind: 'clear', show: 's1', rev: 3 })).toEqual({ kind: 'clear', show: 's1', rev: 3, page: 1 });
  });
});
