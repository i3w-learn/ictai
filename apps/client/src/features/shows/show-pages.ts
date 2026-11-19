// The page one step (`by` = -1 back, +1 on) from `page`, kept between 1 and the last page. While the
// number of pages is not yet known (`pages` is null) there is nowhere to go on to.
export function turnPage(page: number, by: number, pages: number | null): number {
  const last = pages ?? page;
  return Math.min(Math.max(1, page + by), Math.max(1, last));
}
