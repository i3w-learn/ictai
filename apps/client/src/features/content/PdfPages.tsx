import { useEffect, useRef, useState, type ReactNode } from 'react';
// The "legacy" build carries its own stand-ins for the newest browser features, so books open on
// school PCs whose built-in browser part has not been updated for a while.
import { getDocument, GlobalWorkerOptions, PDFDataRangeTransport, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { useLatest } from '../../ui/ui';
import { fitInside, totalOf } from './pdf-pages';

// pdf.js reads the book in a second thread, so turning pages never freezes the screen.
GlobalWorkerOptions.workerSrc = workerUrl;

// How much of the book is asked for at a time: page 1 shows after a few of these, not the whole book.
const PART = 262144;
// The files pdf.js needs from the app itself (see vite.config.ts), as full addresses, because the
// second thread lives at another address and would read a short one differently.
const own = (dir: string) => new URL(`${import.meta.env.BASE_URL}pdfjs/${dir}/`, document.baseURI).href;
// (pdf.js 5 no longer runs made-up code with eval at all, so there is no isEvalSupported to turn off.)
const OPTIONS: DocumentInitParameters = {
  disableAutoFetch: true,
  rangeChunkSize: PART,
  cMapUrl: own('cmaps'),
  cMapPacked: true,
  standardFontDataUrl: own('standard_fonts'),
  wasmUrl: own('wasm'),
  iccUrl: own('iccs'),
};

// Bytes `begin` up to (not including) `end` of a streamed file. The server sends at most a few MB per
// answer, so a long stretch takes several asks.
async function readPart(url: string, begin: number, end: number, signal: AbortSignal) {
  const out = new Uint8Array(end - begin);
  let at = begin;
  while (at < end) {
    const res = await fetch(url, { headers: { Range: `bytes=${at}-${end - 1}` }, signal });
    const from = Number(/^bytes (\d+)-/.exec(res.headers.get('content-range') ?? '')?.[1]);
    if (res.status !== 206 || from !== at) throw new Error(`The file part did not come (${res.status}).`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) throw new Error('The file part was empty.');
    out.set(bytes.subarray(0, end - at), at - begin);
    at += bytes.length;
  }
  return out;
}

// What pdf.js is handed to read the book. A file already in memory (a blob: address) is handed over
// as it is. A streamed one is asked for part by part: the first part tells the whole size, and pdf.js
// then asks only for the parts the page in front of it needs. `fail` is called if a later part
// cannot be had even on a second try.
async function sourceOf(url: string, signal: AbortSignal, fail: () => void): Promise<DocumentInitParameters> {
  if (url.startsWith('blob:')) return { url };
  const res = await fetch(url, { headers: { Range: `bytes=0-${PART - 1}` }, signal });
  // A server that ignores the Range header sends the whole book at once.
  if (res.status === 200) return { data: new Uint8Array(await res.arrayBuffer()) };
  const total = totalOf(res.headers.get('content-range'));
  if (res.status !== 206 || !total) throw new Error(`The book could not be opened (${res.status}).`);
  const range = new PDFDataRangeTransport(total, new Uint8Array(await res.arrayBuffer()));
  range.requestDataRange = (begin, end) => {
    readPart(url, begin, end, signal)
      .catch(() => readPart(url, begin, end, signal))
      .then((bytes) => range.onDataRange(begin, bytes), () => { if (!signal.aborted) fail(); });
  };
  return { range };
}

// One page of a PDF, drawn whole inside its box (no zoom), with `layer` (the writing) laid over the
// same box. It says how many pages the book has once, and the shape of each page as it comes, so the
// writing layer can find the page in the box the same way. `onError` is called when the book cannot
// be read, so the caller can try another way of getting the file.
export function PdfPages({ url, page, onPages, onAspect, onError, layer }: {
  url: string;
  page: number;
  onPages: (n: number) => void;
  onAspect: (a: number) => void;
  onError: () => void;
  layer?: ReactNode;
}) {
  const told = useLatest({ onPages, onAspect, onError });
  const [doc, setDoc] = useState<{ url: string; pdf: PDFDocumentProxy } | null>(null);
  const [shown, setShown] = useState<{ key: string; page: PDFPageProxy } | null>(null);
  const [drawn, setDrawn] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const seen = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);

  // Open the book; close it, and stop any reading still going on, when it is put away.
  useEffect(() => {
    let stopped = false;
    const stop = new AbortController();
    let task: ReturnType<typeof getDocument> | null = null;
    const fail = () => { if (!stopped) { stopped = true; told.current.onError(); } };
    (async () => {
      const source = await sourceOf(url, stop.signal, fail);
      if (stopped) return;
      task = getDocument({ ...source, ...OPTIONS });
      const pdf = await task.promise;
      if (stopped) return;
      setDoc({ url, pdf });
      told.current.onPages(pdf.numPages);
    })().catch(fail);
    return () => { stopped = true; stop.abort(); void task?.destroy(); };
  }, [url, told]);

  // Fetch the page asked for (kept within the book).
  const pdf = doc?.url === url ? doc.pdf : null;
  const number = pdf ? Math.min(Math.max(1, Math.round(page)), pdf.numPages) : 0;
  const key = `${url}#${number}`;
  useEffect(() => {
    if (!pdf) return;
    let stopped = false;
    pdf.getPage(number).then((p) => {
      if (stopped) return;
      const { width, height } = p.getViewport({ scale: 1 });
      setShown({ key, page: p });
      told.current.onAspect(width / height);
    }, () => { if (!stopped) told.current.onError(); });
    return () => { stopped = true; };
  }, [pdf, number, key, told]);

  // Draw it sharp for this screen. A page still being drawn when another is asked for is dropped.
  const current = shown?.key === key ? shown.page : null;
  const base = current?.getViewport({ scale: 1 });
  const fit = base ? fitInside(size.w, size.h, base.width / base.height) : null;
  const fw = fit?.width ?? 0;
  const fh = fit?.height ?? 0;
  useEffect(() => {
    const c = canvas.current;
    if (!current || !c || !fw || !fh) return;
    const sharp = window.devicePixelRatio || 1;
    const viewport = current.getViewport({ scale: (fw / current.getViewport({ scale: 1 }).width) * sharp });
    c.width = Math.round(viewport.width);
    c.height = Math.round(viewport.height);
    let stopped = false;
    const job = current.render({ canvas: c, viewport });
    job.promise.then(() => { if (!stopped) setDrawn(key); }, (e: unknown) => {
      if (stopped || (e instanceof Error && e.name === 'RenderingCancelledException')) return;
      told.current.onError();
    });
    return () => { stopped = true; job.cancel(); };
  }, [current, fw, fh, key, told]);

  const ready = drawn === key && !!fit;
  return (
    <div ref={box} className="relative h-full w-full overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center">
        <canvas ref={canvas} className={ready ? 'bg-white shadow-sm' : 'invisible'} style={fit ? { width: fit.width, height: fit.height } : undefined} />
      </div>
      {!ready && <p className="absolute inset-0 flex items-center justify-center text-muted-foreground" role="status">Opening page…</p>}
      {layer && <div className="absolute inset-0">{layer}</div>}
    </div>
  );
}
