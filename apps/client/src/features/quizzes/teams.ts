import { tk } from '../../i18n/i18n';

// A live quiz can be played in up to four teams. The server numbers them 1 to 4; on the screens each
// has a colour, so a child can say "I am in Red". Student screens say the name through t().
const TEAMS = [
  { name: tk('Red'), chip: 'bg-[hsl(0_80%_93%)] text-[hsl(0_70%_30%)]', dot: 'bg-[hsl(0_72%_50%)]' },
  { name: tk('Blue'), chip: 'bg-[hsl(215_85%_93%)] text-[hsl(215_70%_30%)]', dot: 'bg-[hsl(215_80%_50%)]' },
  { name: tk('Green'), chip: 'bg-[hsl(140_55%_90%)] text-[hsl(140_60%_22%)]', dot: 'bg-[hsl(140_60%_38%)]' },
  { name: tk('Yellow'), chip: 'bg-[hsl(45_95%_88%)] text-[hsl(35_80%_25%)]', dot: 'bg-[hsl(45_95%_48%)]' },
] as const;

export const teamLook = (team: number) => TEAMS[(team - 1) % TEAMS.length]!;

// The place of the team at `index` in a best-first list: teams with the same score share a place.
export const placeOf = (teams: { score: number }[], index: number) => teams.findIndex((t) => t.score === teams[index]!.score) + 1;
