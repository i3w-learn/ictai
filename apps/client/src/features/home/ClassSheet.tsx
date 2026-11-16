import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import type { SignInCard } from '@ict/contracts';
import { Button } from '../../ui/ui';

export type Sheet = { className: string; rows: SignInCard[] };

// A full-screen page of a class's sign-in cards, ready to print.
// Rendered straight into <body> so printing can hide the rest of the app.
export function ClassSheet({ sheet, onClose }: { sheet: Sheet; onClose: () => void }) {
  return createPortal(
    <div className="print-sheet fixed inset-0 z-50 overflow-y-auto bg-card px-6 py-6 text-foreground">
      <div className="no-print mb-5 flex flex-wrap items-center gap-3">
        <h2 className="flex-1 font-display text-xl font-semibold">
          Sign-in cards · Class {sheet.className}
        </h2>
        <Button onClick={() => window.print()}>Print</Button>
        <Button variant="quiet" onClick={onClose}>Close</Button>
      </div>
      <p className="no-print mb-4 text-sm text-muted-foreground">These cards replace any cards printed before. Old cards no longer sign in.</p>
      <CardGrid className={sheet.className} rows={sheet.rows} />
    </div>,
    document.body,
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
        <p className="mt-2 text-xs text-muted-foreground">Show this card to the camera to sign in.</p>
      </div>
    </div>
  );
}
