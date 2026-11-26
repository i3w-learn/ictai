import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../ui/ui';
import { useT } from '../../i18n/i18n';

// The teacher's page buttons, down the right side of a page or board: Previous, "Page x of y" and
// Next, big enough to hit on a touch board. `pages` is null while a PDF's pages are not yet counted,
// and Next waits until they are. `children` go under Next (the whiteboard's "Add page").
export function PageRail({ page, pages, onGo, children }: { page: number; pages: number | null; onGo: (by: number) => void; children?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex w-36 shrink-0 flex-col items-stretch justify-center gap-3">
      <Button variant="quiet" className="min-h-20 flex-col text-base" disabled={page <= 1} onClick={() => onGo(-1)}><ChevronLeft className="size-6" /> {t('Previous')}</Button>
      <span className="text-center text-lg font-semibold tabular-nums" role="status">{t('Page {page} of {pages}', { page, pages: pages ?? '…' })}</span>
      <Button className="min-h-20 flex-col text-base" disabled={pages === null || page >= pages} onClick={() => onGo(1)}><ChevronRight className="size-6" /> {t('Next')}</Button>
      {children}
    </div>
  );
}
