// Small sums for the PDF reader, kept apart from pdf.js so they can be tested on their own.

// How big a page is drawn so that all of it fits in its box, keeping its shape. `aspect` is the
// page's width over its height. The page sits in the middle, with plain bars at the sides or above
// and below when the box has another shape: the same place the writing layer works out for itself.
export function fitInside(boxW: number, boxH: number, aspect: number) {
  if (boxW <= 0 || boxH <= 0 || !(aspect > 0)) return null;
  const width = Math.min(boxW, boxH * aspect);
  return { width: Math.round(width), height: Math.round(width / aspect) };
}

// The whole file's size, from the answer to a request for one part of it ("bytes 0-262143/9000000"),
// or null when the answer does not say.
export function totalOf(contentRange: string | null): number | null {
  const total = Number(/^bytes \d+-\d+\/(\d+)$/.exec(contentRange?.trim() ?? '')?.[1]);
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}
