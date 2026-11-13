import { describe, expect, it } from 'vitest';
import { clockOf, labNow, slotLabel } from './timetable';

const p1 = { periodName: 'Period 1', start: '09:00', end: '09:40', subject: 'Maths' };
const p3 = { periodName: 'Period 3', start: '10:20', end: '11:00', subject: null };

describe('timetable', () => {
  it('names a booking by class and section', () => {
    expect(slotLabel({ className: '7', sectionName: null })).toBe('Class 7');
    expect(slotLabel({ className: '7', sectionName: 'A' })).toBe('Class 7 A');
  });

  it('knows whether the student is in a lab period, waiting for one, or done', () => {
    expect(labNow([p1, p3], '08:30')).toEqual({ now: null, next: p1 });
    expect(labNow([p1, p3], '09:00')).toEqual({ now: p1, next: p3 });
    expect(labNow([p1, p3], '09:40')).toEqual({ now: null, next: p3 }); // the bell has rung
    expect(labNow([p1, p3], '10:59')).toEqual({ now: p3, next: null });
    expect(labNow([p1, p3], '11:00')).toEqual({ now: null, next: null });
    expect(labNow([], '09:00')).toEqual({ now: null, next: null });
  });

  it('reads the clock as HH:MM', () => {
    expect(clockOf(new Date(2026, 10, 12, 9, 5))).toBe('09:05');
  });
});
