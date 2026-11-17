import type { ReactNode } from 'react';
import { KidsArt } from './kids';

// The frame around the screens before anyone is signed in (setup and sign-in): a warm panel with
// three children's faces and a few words about what is happening, and the screen itself beside it.
// The panel keeps its own cream and ink colours on any screen, to match the picture. On a narrow
// window only the screen shows. On a very wide window the pair stays together in the middle, and the
// panel is no wider than the window is tall, so the faces are not cropped.
export function AuthShell({ heading, sub, children }: { heading: string; sub: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[112rem] flex-1">
      <aside className="ui-card no-print m-4 mr-0 hidden w-[45%] max-w-[min(64rem,85vh)] shrink-0 flex-col overflow-hidden rounded-[2.5rem] bg-[hsl(40_48%_92%)] lg:flex">
        <KidsArt className="min-h-0 w-full flex-1" />
        <div className="grid gap-2 p-9 pt-7">
          <p className="font-display text-[clamp(1.75rem,5vh,2.75rem)] leading-[1.08] font-semibold tracking-tight text-balance text-[hsl(252_40%_14%)]">{heading}</p>
          <p className="text-lg text-[hsl(252_20%_30%)]">{sub}</p>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10">
        <div className="grid min-h-full content-center pb-10">{children}</div>
      </main>
    </div>
  );
}
