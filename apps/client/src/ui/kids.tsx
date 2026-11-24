import type { ReactNode } from 'react';
import { useT } from '../i18n/i18n';

// Three children, close up, in a bold flat style: big round faces, big eyes, simple shapes. Drawn in
// code with no picture file, so it shows with no internet. One wears a graduation cap, one has
// headphones on, one has a pencil behind her ear; school things float above them.

const CREAM = 'hsl(40 48% 92%)', PALE = 'hsl(42 60% 96%)', INK = 'hsl(252 30% 12%)';
const PINK = 'hsl(335 78% 76%)', LILAC = 'hsl(262 38% 70%)', TEAL = 'hsl(172 38% 38%)', ORANGE = 'hsl(18 78% 55%)', YELLOW = 'hsl(46 85% 62%)', BLUE = 'hsl(212 58% 52%)';

// A five-pointed star around (cx, cy).
function star(cx: number, cy: number, r: number) {
  return Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2, d = i % 2 ? r * 0.45 : r;
    return `${(cx + d * Math.cos(a)).toFixed(1)},${(cy + d * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

// Each child is drawn around (0, 0) with a head 100 wide each way, then moved and sized into place.
function Child({ x, y, size, children }: { x: number; y: number; size: number; children: ReactNode }) {
  return <g transform={`translate(${x} ${y}) scale(${size / 100})`}>{children}</g>;
}

// What every face shares: ears, the head, eyes looking to one side, a small round nose, a smile
// and two soft cheeks.
function Face({ skin, cheek, look = 1 }: { skin: string; cheek: string; look?: 1 | -1 }) {
  return (
    <>
      <circle cx="-97" cy="8" r="24" fill={skin} />
      <circle cx="97" cy="8" r="24" fill={skin} />
      <circle r="100" fill={skin} />
      {[-1, 1].map((s) => (
        <g key={s}>
          <circle cx={s * 40} cy="-4" r="21" fill="white" />
          <circle cx={s * 40 + look * 6} cy="-6" r="13.5" fill={INK} />
          <ellipse cx={s * 60} cy="38" rx="22" ry="11" fill={cheek} opacity="0.75" />
        </g>
      ))}
      <circle cy="14" r="6.5" fill="none" stroke={INK} strokeWidth="3.2" />
      <path d="M-17 34 q17 21 34 0" fill="none" stroke={INK} strokeWidth="3.8" strokeLinecap="round" />
    </>
  );
}

export function KidsArt({ className }: { className?: string }) {
  const t = useT();
  return (
    <svg className={className} viewBox="0 0 600 680" preserveAspectRatio="xMidYMax slice" role="img" aria-label={t('Three smiling children: one in a graduation cap, one with headphones, one with a pencil behind her ear')}>
      <defs><clipPath id="kid-head"><circle r="100" /></clipPath></defs>
      <rect width="600" height="680" fill={CREAM} />
      {/* Big pale balloons far behind. */}
      <circle cx="50" cy="120" r="130" fill={PALE} /><circle cx="545" cy="170" r="140" fill={PALE} /><circle cx="300" cy="70" r="62" fill={PALE} /><circle cx="560" cy="430" r="70" fill={PALE} /><circle cx="30" cy="380" r="60" fill={PALE} />

      {/* School things in the air. */}
      <polygon points={star(300, 74, 24)} fill={ORANGE} /><polygon points={star(96, 196, 14)} fill={TEAL} /><polygon points={star(528, 62, 16)} fill={YELLOW} /><polygon points={star(42, 300, 15)} fill={BLUE} /><polygon points={star(560, 300, 13)} fill={LILAC} />
      <text x="128" y="104" fontSize="64" fontWeight="800" fill={LILAC} transform="rotate(-12 150 84)">A</text>
      <text x="408" y="128" fontSize="60" fontWeight="800" fill={BLUE} transform="rotate(12 428 108)">B</text>
      <text x="476" y="250" fontSize="50" fontWeight="800" fill={PINK} transform="rotate(10 490 234)">2</text>
      <text x="44" y="72" fontSize="42" fontWeight="800" fill={TEAL} transform="rotate(14 56 60)">+</text>
      <text x="212" y="176" fontSize="40" fontWeight="800" fill={ORANGE} transform="rotate(-8 222 164)">=</text>
      <rect x="226" y="28" width="13" height="30" rx="2" fill={BLUE} transform="rotate(-30 232 43)" /><rect x="372" y="34" width="13" height="30" rx="2" fill={PINK} transform="rotate(25 378 49)" />
      <rect x="18" y="214" width="13" height="28" rx="2" fill={YELLOW} transform="rotate(-20 24 228)" /><rect x="560" y="366" width="13" height="26" rx="2" fill="hsl(24 50% 28%)" transform="rotate(50 566 379)" />
      <path d="M350 176 q22 -14 40 6" fill="none" stroke={TEAL} strokeWidth="9" strokeLinecap="round" /><path d="M150 252 q-12 18 -4 36" fill="none" stroke={BLUE} strokeWidth="9" strokeLinecap="round" /><path d="M440 320 q18 12 34 2" fill="none" stroke={PINK} strokeWidth="9" strokeLinecap="round" />
      <g transform="rotate(-38 86 130)"><rect x="77" y="92" width="18" height="66" fill={YELLOW} /><polygon points="77,158 95,158 86,180" fill="hsl(30 55% 74%)" /><polygon points="82,170 90,170 86,180" fill={INK} /><rect x="77" y="80" width="18" height="14" rx="3" fill={PINK} /></g>

      {/* Behind, in the middle: blond hair, a teal top, headphones for the lab. */}
      <Child x={300} y={322} size={104}>
        <ellipse cy="-42" rx="114" ry="86" fill={YELLOW} />
        <ellipse cy="186" rx="165" ry="108" fill={TEAL} />
        <Face skin="hsl(350 48% 85%)" cheek="hsl(345 60% 76%)" look={-1} />
        <g clipPath="url(#kid-head)"><rect x="-110" y="-108" width="220" height="73" fill={YELLOW} /><polygon points="-30,-30 -15,-80 -5,-30" fill="hsl(350 48% 85%)" /></g>
        <path d="M-107 0 A107 107 0 0 1 107 0" fill="none" stroke={BLUE} strokeWidth="15" strokeLinecap="round" />
        <rect x="-125" y="-26" width="36" height="68" rx="17" fill={BLUE} /><rect x="89" y="-26" width="36" height="68" rx="17" fill={BLUE} />
      </Child>

      {/* In front, left: long black hair, a lilac top with white spots, a graduation cap. */}
      <Child x={156} y={512} size={124}>
        <ellipse cy="24" rx="130" ry="136" fill={INK} />
        <ellipse cy="178" rx="165" ry="100" fill={LILAC} /><ellipse cx="-64" cy="122" rx="28" ry="16" fill="white" transform="rotate(20 -64 122)" /><ellipse cx="60" cy="118" rx="28" ry="16" fill="white" transform="rotate(-20 60 118)" />
        <Face skin="hsl(27 46% 46%)" cheek="hsl(22 50% 36%)" />
        <g clipPath="url(#kid-head)" fill={INK}><rect x="-108" y="-108" width="216" height="60" />{[-72, -24, 24, 72].map((cx) => <circle key={cx} cx={cx} cy="-48" r="26" />)}</g>
        <rect x="-54" y="-128" width="108" height="32" rx="8" fill="hsl(252 40% 30%)" /><polygon points="-96,-130 0,-168 96,-130 0,-93" fill="hsl(252 45% 22%)" />
        <path d="M0 -130 L70 -119 V-80" fill="none" stroke={YELLOW} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" /><rect x="62" y="-82" width="16" height="22" rx="3" fill={YELLOW} />
      </Child>

      {/* In front, right: red hair in two bunches with curls, a pink flowered top, a pencil behind her ear. */}
      <Child x={446} y={520} size={128}>
        <circle cx="-94" cy="86" r="32" fill={ORANGE} /><circle cx="94" cy="86" r="32" fill={ORANGE} />
        <ellipse cy="176" rx="160" ry="98" fill={PINK} />
        {[[-64, 124], [8, 134], [70, 120]].map(([fx, fy]) => <g key={fx} fill="hsl(335 80% 86%)">{[0, 72, 144, 216, 288].map((a) => <circle key={a} cx={fx! + 9 * Math.cos((a * Math.PI) / 180)} cy={fy! + 9 * Math.sin((a * Math.PI) / 180)} r="7" />)}</g>)}
        <Face skin="hsl(20 72% 80%)" cheek="hsl(14 55% 68%)" look={-1} />
        <g clipPath="url(#kid-head)"><rect x="-106" y="-106" width="212" height="67" fill={ORANGE} />{[-52, 0, 52].map((cx) => <ellipse key={cx} cx={cx} cy="-58" rx="25" ry="31" fill="none" stroke={INK} strokeWidth="3.6" />)}</g>
        <g transform="rotate(28 90 -67)"><rect x="83" y="-108" width="15" height="65" fill={YELLOW} /><polygon points="83,-108 98,-108 90.5,-125" fill="hsl(30 55% 74%)" /><rect x="83" y="-45" width="15" height="12" rx="3" fill={PINK} /></g>
      </Child>
    </svg>
  );
}
