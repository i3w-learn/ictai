import { InkToolbar, type InkTools } from './Ink';

// The teacher's pen, down the left side of a page or board: a dark strip with the pen, its colours
// and widths, the eraser and Wipe, one above the other.
export function PenRail({ tools, onTools, onWipe }: { tools: InkTools; onTools: (t: InkTools) => void; onWipe: () => void }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center rounded-2xl bg-[hsl(222_30%_10%)] px-1.5 py-3">
      <InkToolbar vertical tools={tools} onTools={onTools} onWipe={onWipe} />
    </div>
  );
}
