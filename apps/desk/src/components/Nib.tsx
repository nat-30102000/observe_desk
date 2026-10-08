import type { Mood } from '@observe/core';

interface Pose {
  px: number;
  py: number;
  eyeR: number;
  lid: number;
  mouth: string;
  filled: boolean;
  tongue?: boolean;
  zzz?: boolean;
  pen?: boolean;
  bell?: boolean;
  spark?: boolean;
  arc?: boolean;
  think?: boolean;
  brow?: boolean;
  sweat?: boolean;
  mic?: boolean;
  cam?: boolean;
  mail?: boolean;
  shades?: boolean;
}

const OPEN = 'M90 134 Q100 150 110 134 Q100 127 90 134Z';

/** Same poses as the design canvas. */
const POSES: Record<Mood, Pose> = {
  idle: { px: 0, py: 0, eyeR: 18, lid: 0, mouth: 'M82 134 Q100 150 118 134', filled: false },
  curious: { px: -4, py: -3, eyeR: 21, lid: 0, mouth: OPEN, filled: true, pen: true },
  nom: { px: 0, py: 3, eyeR: 18, lid: 22, mouth: 'M70 122 Q100 180 130 122 Q100 112 70 122Z', filled: true, tongue: true, spark: true },
  sleepy: { px: 0, py: 4, eyeR: 18, lid: 30, mouth: 'M88 138 L112 138', filled: false, zzz: true },
  reminder: { px: 3, py: -2, eyeR: 20, lid: 0, mouth: OPEN, filled: true, bell: true },
  happy: { px: 0, py: 0, eyeR: 18, lid: 52, mouth: 'M70 124 Q100 168 130 124 Q100 132 70 124Z', filled: true, tongue: true, spark: true, arc: true },
  thinking: { px: 5, py: -5, eyeR: 18, lid: 0, mouth: 'M88 138 Q94 132 100 138 Q106 144 112 138', filled: false, think: true },
  listening: { px: 0, py: 0, eyeR: 21, lid: 0, mouth: OPEN, filled: true, mic: true },
  worried: { px: 0, py: 5, eyeR: 19, lid: 0, mouth: 'M84 146 Q100 128 116 146', filled: false, brow: true, sweat: true },
  cheese: { px: 6, py: 0, eyeR: 18, lid: 0, mouth: 'M80 132 Q100 154 120 132', filled: false, spark: true, cam: true },
  newsflash: { px: 3, py: -2, eyeR: 22, lid: 0, mouth: 'M86 132 Q100 156 114 132 Q100 124 86 132Z', filled: true, spark: true, mail: true },
  chill: { px: 0, py: 0, eyeR: 18, lid: 0, mouth: 'M84 138 Q104 150 122 132', filled: false, shades: true },
};

const INK = '#2B2140';
const BODY = '#8B6CFF';
const op = (on?: boolean) => (on ? 1 : 0);

export function Nib({ mood, size = 200, label }: { mood: Mood; size?: number; label?: string }) {
  const p = POSES[mood];
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={label ?? `Nib looking ${mood}`}>
      <ellipse cx="100" cy="192" rx="56" ry="7" fill={INK} opacity=".14" />
      <ellipse cx="70" cy="186" rx="20" ry="9" fill="#6E4FE0" stroke={INK} strokeWidth="4" />
      <ellipse cx="130" cy="186" rx="20" ry="9" fill="#6E4FE0" stroke={INK} strokeWidth="4" />
      <path d="M100 26 C152 26 182 72 182 124 C182 168 146 188 100 188 C54 188 18 168 18 124 C18 72 48 26 100 26Z" fill={BODY} stroke={INK} strokeWidth="5" />
      <path d="M52 76 C58 58 74 46 90 43" stroke="#fff" strokeOpacity=".5" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M100 4 L114 30 Q100 42 86 30Z" fill="#FFC93C" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <line x1="100" y1="16" x2="100" y2="31" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <circle cx="70" cy="100" r={p.eyeR} fill="#fff" stroke={INK} strokeWidth="4" />
      <circle cx="130" cy="100" r={p.eyeR} fill="#fff" stroke={INK} strokeWidth="4" />
      <circle cx={70 + p.px} cy={100 + p.py} r="8" fill={INK} />
      <circle cx={130 + p.px} cy={100 + p.py} r="8" fill={INK} />
      <rect x="48" y="74" width="104" height={p.lid} fill={BODY} />
      <g opacity={op(p.arc)} stroke={INK} strokeWidth="5" strokeLinecap="round" fill="none">
        <path d="M54 102 Q70 84 86 102" />
        <path d="M114 102 Q130 84 146 102" />
      </g>
      <ellipse cx="44" cy="130" rx="10" ry="6" fill="#FF8FA3" opacity=".85" />
      <ellipse cx="156" cy="130" rx="10" ry="6" fill="#FF8FA3" opacity=".85" />
      <path d={p.mouth} fill={p.filled ? INK : 'none'} stroke={INK} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="100" cy="150" rx="13" ry="7" fill="#FF8FA3" opacity={op(p.tongue)} />
      <g opacity={op(p.zzz)} fill={INK} fontWeight="700">
        <text x="150" y="38" fontSize="30">Z</text>
        <text x="168" y="18" fontSize="20">z</text>
      </g>
      <g opacity={op(p.pen)}><rect x="152" y="118" width="14" height="52" rx="4" transform="rotate(25 159 144)" fill="#FFC93C" stroke={INK} strokeWidth="4" /></g>
      <g opacity={op(p.bell)}>
        <path d="M20 160 q0 -26 16 -26 q16 0 16 26z" fill="#FFC93C" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
        <circle cx="36" cy="166" r="5" fill={INK} />
      </g>
      <g opacity={op(p.spark)} fill="#FFC93C" stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
        <path d="M26 44 L29 53 L38 56 L29 59 L26 68 L23 59 L14 56 L23 53Z" />
        <path d="M176 70 L178 77 L185 79 L178 81 L176 88 L174 81 L167 79 L174 77Z" />
      </g>
      <g opacity={op(p.think)} fill="#fff" stroke={INK} strokeWidth="3">
        <circle cx="150" cy="40" r="5" />
        <circle cx="164" cy="26" r="7" />
        <circle cx="182" cy="10" r="9" />
      </g>
      <g opacity={op(p.brow)} stroke={INK} strokeWidth="5" strokeLinecap="round">
        <path d="M52 80 L88 68" />
        <path d="M148 80 L112 68" />
      </g>
      <path opacity={op(p.sweat)} d="M160 60 q-9 14 0 20 q9 -6 0 -20z" fill="#8FD3FF" stroke={INK} strokeWidth="3" />
      <g opacity={op(p.mic)}>
        <rect x="150" y="126" width="16" height="30" rx="8" fill="#fff" stroke={INK} strokeWidth="4" />
        <path d="M144 144 q14 18 28 0" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
        <line x1="158" y1="160" x2="158" y2="172" stroke={INK} strokeWidth="4" strokeLinecap="round" />
        <circle cx="28" cy="46" r="8" fill="#FF5C7A" stroke={INK} strokeWidth="3" />
      </g>
      <g opacity={op(p.cam)}>
        <rect x="126" y="134" width="52" height="34" rx="8" fill="#FFFDF8" stroke={INK} strokeWidth="4" />
        <circle cx="152" cy="151" r="10" fill="#8FD3FF" stroke={INK} strokeWidth="4" />
        <rect x="136" y="127" width="14" height="9" rx="2" fill={INK} />
      </g>
      <g opacity={op(p.mail)}>
        <rect x="130" y="138" width="48" height="32" rx="5" fill="#fff" stroke={INK} strokeWidth="4" />
        <path d="M133 143 L154 159 L175 143" fill="none" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      </g>
      <g opacity={op(p.shades)}>
        <rect x="44" y="86" width="50" height="28" rx="10" fill={INK} />
        <rect x="106" y="86" width="50" height="28" rx="10" fill={INK} />
        <path d="M94 96 L106 96" stroke={INK} strokeWidth="4" />
        <path d="M52 93 L66 93" stroke="#fff" strokeOpacity=".5" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
}
