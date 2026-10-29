import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import type { ClassCode, SignInCard } from '@ict/contracts';
import { Button } from '../../ui/ui';

export type Sheet = { kind: 'codes'; className: string; rows: ClassCode[] } | { kind: 'cards'; className: string; rows: SignInCard[] };

const until = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

// A full-screen page for a class's first sign-in codes or sign-in cards, ready to print.
// Rendered straight into <body> so printing can hide the rest of the app.
export function ClassSheet({ sheet, onClose }: { sheet: Sheet; onClose: () => void }) {
  return createPortal(
    <div className="print-sheet fixed inset-0 z-50 overflow-y-auto bg-card px-6 py-6 text-foreground">
      <div className="no-print mb-5 flex flex-wrap items-center gap-3">
        <h2 className="flex-1 font-display text-xl font-semibold">
          {sheet.kind === 'cards' ? 'Sign-in cards' : 'First sign-in codes'} · Class {sheet.className}
        </h2>
        <Button onClick={() => window.print()}>Print</Button>
        <Button variant="quiet" onClick={onClose}>Close</Button>
      </div>
      {sheet.kind === 'cards' && (
        <p className="no-print mb-4 text-sm text-muted-foreground">These cards replace any cards printed before. Old cards no longer sign in.</p>
      )}
      {sheet.kind === 'codes' ? <CodeList rows={sheet.rows} /> : <CardGrid className={sheet.className} rows={sheet.rows} />}
    </div>,
    document.body,
  );
}

function CodeList({ rows }: { rows: ClassCode[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-muted-foreground">
        <tr><th className="py-2 pr-4">Roll</th><th className="py-2 pr-4">Name</th><th className="py-2 pr-4">Code</th><th className="py-2">Use by</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.studentId} className="border-t border-border">
            <td className="py-2 pr-4 tabular-nums">{r.rollNo ?? '–'}</td>
            <td className="py-2 pr-4 font-medium">{r.name}</td>
            <td className="py-2 pr-4 font-mono text-base tracking-widest text-primary">{r.code}</td>
            <td className="py-2">{until(r.expiresAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CardGrid({ className, rows }: { className: string; rows: SignInCard[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4">
      {rows.map((r) => <Card key={r.studentId} className={className} card={r} />)}
    </div>
  );
}

function Card({ className, card }: { className: string; card: SignInCard }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => { void QRCode.toDataURL(card.qrToken, { margin: 1, width: 160 }).then(setQr); }, [card.qrToken]);

  return (
    <div className="flex break-inside-avoid gap-3 rounded-xl border border-border p-3">
      {qr ? <img src={qr} alt={`QR card for ${card.name}`} className="size-28" /> : <div className="size-28" />}
      <div className="grid content-start gap-1 text-sm">
        <p className="font-semibold">{card.name}</p>
        <p className="text-muted-foreground">Class {className}{card.rollNo ? ` · Roll ${card.rollNo}` : ''}</p>
        <p className="mt-2 text-xs text-muted-foreground">First sign-in code</p>
        <p className="font-mono text-lg tracking-widest text-primary">{card.code}</p>
        <p className="text-xs text-muted-foreground">Use by {until(card.expiresAt)}</p>
      </div>
    </div>
  );
}
