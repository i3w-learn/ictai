import { useEffect, useState } from 'react';
import { useApp } from '../../app/app-context';

// The mark moves to a new place this often, so cutting one corner off a recording does not remove it.
const MOVE_EVERY_MS = 20_000;

// Where the mark sits, in turn. Never the middle (that is where the lesson is) and never the very
// bottom edge (a lesson often has writing there).
export const SPOTS = ['top-3 left-4', 'top-3 right-4', 'top-1/3 right-4', 'bottom-1/4 left-4', 'top-1/3 left-4'] as const;
export const spotAt = (turn: number) => SPOTS[((turn % SPOTS.length) + SPOTS.length) % SPOTS.length]!;

// The school's name, written faintly over a playing video. Our video files open only inside the app,
// so the way a lesson leaks is somebody filming or recording the screen; the name in the picture then
// says which school it came from. It takes no clicks, and a screen reader does not read it.
export function SchoolMark() {
  const name = useApp().state.settings.server?.name.trim();
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTurn((n) => n + 1), MOVE_EVERY_MS);
    return () => clearInterval(timer);
  }, []);
  if (!name) return null;
  return (
    <span
      aria-hidden data-school-mark
      // White with a dark edge, so it shows on a light picture and on a dark one.
      className={`pointer-events-none absolute z-10 max-w-[60%] truncate text-sm font-semibold text-white/35 select-none [text-shadow:0_0_2px_rgb(0_0_0/0.6)] ${spotAt(turn)}`}
    >
      {name}
    </span>
  );
}
