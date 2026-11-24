import { useId } from 'react';

/*
 * ChatPhoto: the pictures the gear can attach to a message, drawn as inline SVG (a meal, the health booklet, a crib). Soft,
 * matte forms in the brand tones. No people and no image files. A photo a patient chooses from her own phone is shown as an
 * <img> by ChatThread instead.
 */
function Meal({ p }) {
  return (
    <>
      <circle cx="100" cy="72" r="52" fill="var(--surface)" />
      <circle cx="100" cy="72" r="52" fill="none" stroke={`url(#${p})`} strokeWidth="6" />
      <circle cx="100" cy="72" r="36" fill="var(--surface-strong)" />
      <circle cx="84" cy="66" r="14" fill="var(--coral-400)" />
      <circle cx="112" cy="62" r="12" fill="var(--lilac-400)" />
      <ellipse cx="102" cy="86" rx="18" ry="9" fill="var(--primary-100)" />
      <ellipse cx="78" cy="60" rx="5" ry="3" fill="var(--surface)" opacity="0.5" />
    </>
  );
}

function Booklet({ p }) {
  return (
    <>
      <rect x="54" y="18" width="92" height="104" rx="12" fill={`url(#${p})`} />
      <rect x="62" y="18" width="6" height="104" rx="3" fill="var(--surface)" opacity="0.3" />
      <path d="M104 98C80 82 76 66 86 58C94 52 102 56 104 63C106 56 114 52 122 58C132 66 128 82 104 98Z" fill="var(--surface)" />
      <rect x="82" y="32" width="44" height="6" rx="3" fill="var(--surface)" opacity="0.7" />
    </>
  );
}

function Crib({ p }) {
  return (
    <>
      <rect x="40" y="64" width="120" height="34" rx="10" fill={`url(#${p})`} />
      <rect x="36" y="30" width="8" height="88" rx="4" fill="var(--primary-600)" />
      <rect x="156" y="30" width="8" height="88" rx="4" fill="var(--primary-600)" />
      {[62, 80, 100, 120, 138].map((x) => (
        <rect key={x} x={x - 2} y="38" width="4" height="26" rx="2" fill="var(--primary-600)" opacity="0.6" />
      ))}
      <circle cx="100" cy="58" r="12" fill="var(--coral-400)" />
      <ellipse cx="96" cy="54" rx="4" ry="2.5" fill="var(--surface)" opacity="0.5" />
    </>
  );
}

const SCENES = { meal: Meal, booklet: Booklet, crib: Crib };

/** name: meal | booklet | crib. `label` is the picture's accessible name (it is the content of the message). */
export default function ChatPhoto({ name, label, className = '' }) {
  const id = useId().replace(/:/g, '');
  const Scene = SCENES[name] ?? Meal;
  const gradient = `${id}g`;
  return (
    <svg className={['chat-photo', className].filter(Boolean).join(' ')} viewBox="0 0 200 140" role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--coral-400)" />
          <stop offset="0.5" stopColor="var(--lilac-400)" />
          <stop offset="1" stopColor="var(--primary-600)" />
        </linearGradient>
      </defs>
      <rect width="200" height="140" rx="16" fill="var(--primary-100)" />
      <ellipse cx="100" cy="124" rx="56" ry="6" fill="var(--primary-600)" opacity="0.12" />
      <Scene p={gradient} />
    </svg>
  );
}
