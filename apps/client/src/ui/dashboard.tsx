import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CARD_LOOK, cn } from './ui';

// The area under the top bar: an optional side menu, and the page beside it. The page is the one
// <main>, which is what a student's text-size choice enlarges.
export function Shell({ menu, children }: { menu?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1">
      {menu}
      <main className="min-w-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10">{children}</main>
    </div>
  );
}

export interface MenuItem<K extends string> { key: K; label: string; icon: LucideIcon }

// The menu down the left side. In a narrow window it shrinks to icons only.
export function SideMenu<K extends string>({ label, items, current, onPick, footer }: { label: string; items: MenuItem<K>[]; current: K; onPick: (key: K) => void; footer?: ReactNode }) {
  return (
    <nav aria-label={label} className="ui-menu no-print flex w-[4.5rem] shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-card p-3 lg:w-60 lg:p-4">
      {items.map(({ key, label: name, icon: Icon }) => {
        const on = key === current;
        return (
          <button
            key={key} type="button" title={name} aria-label={name} aria-current={on ? 'page' : undefined} onClick={() => onPick(key)}
            className={cn(
              'ui-nav flex min-h-11 cursor-pointer items-center justify-center gap-3 rounded-xl px-3 text-[15px] transition-colors lg:justify-start',
              on ? 'bg-primary/10 font-semibold text-primary' : 'font-medium text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            <Icon className="size-5 shrink-0" strokeWidth={on ? 2.25 : 1.75} />
            <span className="hidden lg:inline">{name}</span>
          </button>
        );
      })}
      {footer && <div className="mt-auto pt-4">{footer}</div>}
    </nav>
  );
}

// One part of a dashboard: a heading, an optional button beside it, and what it shows. It has no box
// of its own; the things inside it are the white cards.
export function Block({ title, first, action, children }: { title: ReactNode; first?: boolean; action?: ReactNode; children: ReactNode }) {
  const Heading = first ? 'h1' : 'h2';
  return (
    <section className="grid content-start gap-4">
      <header className="flex min-h-11 items-center justify-between gap-3">
        <Heading className="font-display text-2xl font-semibold tracking-tight text-balance">{title}</Heading>
        {action}
      </header>
      {children}
    </section>
  );
}

// What a block says when it has nothing to show yet.
export function Empty({ children, icon: Icon }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="ui-empty flex items-center justify-center gap-5 rounded-3xl border border-dashed border-border p-7 text-muted-foreground">
      {Icon && <span className="ui-bubble grid size-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon className="size-7" strokeWidth={1.75} /></span>}
      <p className={Icon ? 'max-w-xs' : 'text-center'}>{children}</p>
    </div>
  );
}

// A tall rounded bar for one score out of 100. It fills from the bottom as far as the score;
// `strong` picks one bar out in the main colour.
export function ResultBar({ label, percent, strong }: { label: string; percent: number; strong?: boolean }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      role="img" aria-label={`${label}: ${p} percent`}
      className={cn('ui-bar relative flex h-44 w-[4.5rem] shrink-0 flex-col items-center justify-between overflow-hidden rounded-full py-5', strong ? 'ui-strong bg-primary text-primary-foreground shadow-[0_14px_28px_-10px_var(--primary)]' : CARD_LOOK)}
    >
      {!strong && <span className="absolute inset-x-0 bottom-0 bg-primary/10" style={{ height: `${p}%` }} />}
      <span className="relative max-h-24 rotate-180 truncate text-sm font-medium [writing-mode:vertical-rl]">{label}</span>
      <span className="relative text-xl font-semibold tabular-nums">{p}<span className="text-xs font-medium"> %</span></span>
    </div>
  );
}

// A row that shows how far along something is: its name, "3 of 5", and a thin bar.
export function ProgressRow({ title, sub, done, total, onClick }: { title: string; sub?: string; done: number; total: number; onClick: () => void }) {
  const p = total > 0 ? Math.round((done / total) * 100) : 0;
  const finished = total > 0 && done >= total;
  return (
    <button type="button" onClick={onClick} className={cn('ui-row grid w-full cursor-pointer gap-2 rounded-3xl px-6 py-4 text-left transition-shadow hover:shadow-lg', CARD_LOOK)}>
      <span className="grid gap-0.5">
        <span className="truncate text-lg font-semibold">{title}</span>
        {sub && <span className="truncate text-sm text-muted-foreground">{sub}</span>}
      </span>
      <span className="flex items-center gap-3">
        <span className="font-semibold tabular-nums">{p}%</span>
        <span className="h-2.5 w-24 overflow-hidden rounded-full bg-secondary" role="img" aria-label={`${done} of ${total} done`}>
          <span className={cn('block h-full rounded-full', finished ? 'bg-success' : 'bg-primary')} style={{ width: `${p}%` }} />
        </span>
        <span className="flex-1 text-right text-sm text-muted-foreground">{finished ? 'All done' : `${done} of ${total} done`}</span>
      </span>
    </button>
  );
}

// Deep colours that white text reads well on. A cover takes its colour from its subject, so the
// same subject always looks the same and no picture files are needed.
const COVER = ['hsl(243 60% 50%)', 'hsl(262 55% 46%)', 'hsl(199 80% 32%)', 'hsl(162 65% 26%)', 'hsl(20 80% 40%)', 'hsl(335 60% 42%)', 'hsl(220 70% 42%)', 'hsl(285 45% 40%)'];
function coverColour(seed: string) {
  let sum = 0;
  for (const ch of seed) sum = (sum * 31 + ch.codePointAt(0)!) % 9973;
  return COVER[sum % COVER.length];
}

// A big coloured tile for a book, picture or video.
export function CoverCard({ title, kind, colourFrom, icon: Icon, onClick }: { title: string; kind: string; colourFrom: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick} style={{ backgroundColor: coverColour(colourFrom) }}
      className="ui-cover relative flex h-44 w-full cursor-pointer flex-col justify-end overflow-hidden rounded-3xl p-5 text-left text-white shadow-[0_16px_32px_-18px_rgba(49,46,129,0.6)] transition-transform hover:-translate-y-0.5"
    >
      <Icon className="absolute -top-4 -right-4 size-32 text-white/15" strokeWidth={1.25} aria-hidden />
      <span className="relative text-[11px] font-semibold tracking-[0.14em] text-white/80 uppercase">{kind}</span>
      <span className="relative line-clamp-3 font-display text-xl leading-tight font-semibold">{title}</span>
    </button>
  );
}
