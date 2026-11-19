import type { ShowKind } from '@ict/contracts';


// The page one step (`by` = -1 back, +1 on) from `page`, kept between 1 and the last page. While the
// number of pages is not yet known (`pages` is null) there is nowhere to go on to.
export function turnPage(page: number, by: number, pages: number | null): number {
  const last = pages ?? page;
  return Math.min(Math.max(1, page + by), Math.max(1, last));
}

// Where a show that has just begun (or begun again, after the server lost it) starts. A book keeps
// the page the teacher is on. A whiteboard always starts blank at page 1 of 1: its pages live only
// in the server's memory, and the server lets a whiteboard grow by one page at a time.
export function startingPlace(kind: ShowKind, at: { page: number; pages?: number }): { page: number; pages?: number } {
  return kind === 'whiteboard' ? { page: 1, pages: 1 } : at;
}
